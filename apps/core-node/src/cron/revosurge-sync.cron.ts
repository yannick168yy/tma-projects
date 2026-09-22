// RevoSurge 二期事件同步：提现 / 充值失败 / KYC / 封禁 / 登录。
//
// 为什么用扫表而不是挂业务触发点：这些状态的写入点是散的——提现 completed 就有 5 处
// （4 个支付回调 + 管理后台审核，还横跨 bff 的 Redis 路径），挨个挂必漏。扫 updated_at
// 增量则只有一个入口，漏发的风险从「改代码时忘了挂」降为零。
//
// 幂等仍由 bg_capi_event 唯一键兜底，所以窗口可以放宽重叠扫描：某次任务失败，下一轮
// 照样能补上，重复扫到的会被 claim 挡住。
//
// 注册与充值不在这里——那两个有唯一汇合点，走实时回传（capi 的触发点旁边）。
import type { FastifyInstance } from 'fastify'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { sendEvent, sendEventBatch } from '../services/revosurge.service.js'
import { forEachTenant } from '../lib/tenant-jobs.js'

const INTERVAL_MS = 2 * 60 * 1000
// 扫描窗口远大于执行间隔：任务偶发失败或重启时能自行补上，重复部分被幂等表吃掉
const LOOKBACK_MS = 30 * 60 * 1000
// 对方批量接口硬上限 600，留余量
const BET_BATCH_SIZE = 500

/** 状态类事件没有订单号，用「userId:状态变更秒级时间戳」当幂等键——
 *  同一次变更反复扫到是同一个键，下一次真实变更则是新键，可以再发一条 */
function stateEventId(userId: string, changedAt: unknown): string {
  const ms = changedAt instanceof Date ? changedAt.getTime() : Date.parse(String(changedAt))
  return `${userId}:${Number.isFinite(ms) ? Math.floor(ms / 1000) : 0}`
}

async function syncWithdrawals(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, amount, currency FROM bg_withdraw_order
     WHERE status = 'completed' AND updated_at >= ? LIMIT 500`,
    [since],
  )
  for (const r of rows) {
    await sendEvent(db, {
      userId: String(r.user_id),
      eventName: 'withdraw',
      eventId: String(r.order_id),
      fields: {
        amount: Number(r.amount),
        currency: String(r.currency ?? 'PHP').toUpperCase(),
        transaction_id: String(r.order_id),
      },
    })
  }
  return rows.length
}

async function syncFailedDeposits(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, amount, currency, channel FROM bg_deposit_order
     WHERE status IN ('failed','rejected','admin_rejected') AND updated_at >= ? LIMIT 500`,
    [since],
  )
  for (const r of rows) {
    await sendEvent(db, {
      userId: String(r.user_id),
      eventName: 'deposit_failed',
      eventId: String(r.order_id),
      fields: {
        attempted_amount: Number(r.amount),
        currency: String(r.currency ?? 'PHP').toUpperCase(),
        // 我方不区分渠道失败原因，其枚举里 unknown 是唯一诚实的值
        failure_reason: 'unknown',
        payment_method: String(r.channel ?? 'unknown'),
        transaction_id: String(r.order_id),
      },
    })
  }
  return rows.length
}

async function syncKyc(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, status, reviewed_at, updated_at FROM bg_kyc
     WHERE status IN ('approved','rejected') AND updated_at >= ? LIMIT 500`,
    [since],
  )
  for (const r of rows) {
    const approved = String(r.status) === 'approved'
    await sendEvent(db, {
      userId: String(r.user_id),
      eventName: approved ? 'kyc_completed' : 'kyc_rejected',
      eventId: stateEventId(String(r.user_id), r.reviewed_at ?? r.updated_at),
      fields: {
        jurisdiction: env.REVOSURGE_JURISDICTION.trim().toUpperCase(),
        kyc_level: 'basic',
        // 我方只有单级实名、且只走证件，其余枚举值用不上
        ...(approved ? { verification_method: 'id_document' } : { rejection_reason: 'other' }),
      },
    })
  }
  return rows.length
}

async function syncAccountStatus(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, status, updated_at FROM bg_user
     WHERE status = 'banned' AND updated_at >= ? LIMIT 500`,
    [since],
  )
  for (const r of rows) {
    await sendEvent(db, {
      userId: String(r.id),
      eventName: 'account_blocked',
      eventId: stateEventId(String(r.id), r.updated_at),
      // 我方封禁原因是自由文本，映射不进其枚举，统一报 other
      fields: { block_reason: 'other' },
    })
  }
  return rows.length
}

/** 登录按「每人每天一条」收敛：原样上报量太大且没有额外信息量，日活信号一条就够 */
async function syncLogins(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, MAX(created_at) last_at, DATE(created_at) d FROM bg_login_log
     WHERE created_at >= ? GROUP BY user_id, DATE(created_at) LIMIT 1000`,
    [since],
  )
  for (const r of rows) {
    await sendEvent(db, {
      userId: String(r.user_id),
      eventName: 'login',
      eventId: `${r.user_id}:${String(r.d)}`,
    })
  }
  return rows.length
}

/** 认证方式本身就是验证事实：google 注册的邮箱由 Google 验证过，phone 注册的手机号
 *  过了短信验证。我方没有独立的「已验证」标志位，这是唯一有真实依据的判定。
 *  每人各发一次——event_id 取 userId，后续再登录会被 claim 挡掉。 */
async function syncVerifications(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT user_id, auth_method FROM bg_login_log
     WHERE created_at >= ? AND auth_method IN ('google','phone') LIMIT 500`,
    [since],
  )
  for (const r of rows) {
    await sendEvent(db, {
      userId: String(r.user_id),
      eventName: String(r.auth_method) === 'google' ? 'email_verified' : 'phone_verified',
      eventId: String(r.user_id),
    })
  }
  return rows.length
}

/** 推荐注册。这是与 register 并列的独立事件（对方目录里就分两个），所以带推荐人的
 *  用户会有两条注册类事件——广告流量几乎不会带推荐人，实际触发量接近零。 */
async function syncReferralRegisters(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM bg_user WHERE inviter_id IS NOT NULL AND created_at >= ? LIMIT 500`,
    [since],
  )
  for (const r of rows) {
    await sendEvent(db, { userId: String(r.id), eventName: 'referral_register', eventId: String(r.id) })
  }
  return rows.length
}

// 厂商 → RevoSurge game_type。对方枚举有 slot/live_casino/sportsbook/lottery/crash/
// fishing/poker/bingo/esports/arcade，我方 provider_id 形如 "jili:103"，取冒号前的厂商名。
// 568win 线的厂商是纯数字 ID（如 "165"）对不上任何名字，连同未知厂商一律落 slot——
// 我方流水绝大部分是老虎机，报非法值会让整条事件被拒，报 slot 至少不失真到别的品类。
const VENDOR_GAME_TYPE: Record<string, string> = {
  jili: 'slot',
  pg: 'slot',
  pp: 'slot',
  pragmatic: 'slot',
  spribe: 'crash',
  evo: 'live_casino',
  evolution: 'live_casino',
  ag: 'live_casino',
  saba: 'sportsbook',
  im: 'sportsbook',
}

function gameType(providerId: string | null): string {
  const vendor = String(providerId ?? '').split(':')[0].trim().toLowerCase()
  return VENDOR_GAME_TYPE[vendor] ?? 'slot'
}

/** 投注按「局」上报：bg_bet_round 已是一局一条的聚合，把下注/派彩的流水明细
 *  （bg_bet_order）拆开报对广告模型没有额外信息量，只会把事件量放大一倍。 */
async function syncBets(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.round_id, r.user_id, r.bet_amount, r.win_amount, r.currency_code, r.aggregator_id,
            MIN(o.provider_id) provider_id
     FROM bg_bet_round r
     LEFT JOIN bg_bet_order o ON o.round_id = r.round_id
     WHERE r.updated_at >= ? AND r.bet_amount > 0
     GROUP BY r.round_id, r.user_id, r.bet_amount, r.win_amount, r.currency_code, r.aggregator_id
     LIMIT ?`,
    [since, BET_BATCH_SIZE],
  )
  if (!rows.length) return 0
  return sendEventBatch(
    db,
    rows.map((r) => {
      const bet = Number(r.bet_amount)
      const win = Number(r.win_amount ?? 0)
      return {
        userId: String(r.user_id),
        eventName: 'bet',
        eventId: String(r.round_id),
        fields: {
          amount: bet,
          currency: String(r.currency_code ?? 'PHP').toUpperCase(),
          transaction_id: String(r.round_id),
          game_provider: String(r.provider_id ?? r.aggregator_id ?? 'unknown'),
          game_type: gameType(r.provider_id as string | null),
          // 其 bet_result 枚举只有 win / loss，没有平局或退款——派彩未超过本金即算 loss
          bet_result: win > bet ? 'win' : 'loss',
          bet_result_amount: win,
        },
      }
    }),
  )
}

async function runOnce(app: FastifyInstance): Promise<void> {
  const db = app.mysql
  const since = new Date(Date.now() - LOOKBACK_MS)
  const [withdrawals, failedDeposits, kyc, blocked, logins, bets, verified, referrals] = [
    await syncWithdrawals(db, since),
    await syncFailedDeposits(db, since),
    await syncKyc(db, since),
    await syncAccountStatus(db, since),
    await syncLogins(db, since),
    await syncBets(db, since),
    await syncVerifications(db, since),
    await syncReferralRegisters(db, since),
  ]
  const total = withdrawals + failedDeposits + kyc + blocked + logins + bets + verified + referrals
  if (total) {
    app.log.info(
      { withdrawals, failedDeposits, kyc, blocked, logins, bets, verified, referrals },
      '[revosurge] synced',
    )
  }
}

export function startRevosurgeSyncCron(app: FastifyInstance): void {
  if (!env.REVOSURGE_API_KEY.trim()) {
    app.log.info('[revosurge] api key not configured, sync disabled')
    return
  }
  const interval = setInterval(
    () => void forEachTenant(app, 'revosurge-sync', () => runOnce(app)),
    INTERVAL_MS,
  )
  app.addHook('onClose', async () => clearInterval(interval))
  app.log.info('[revosurge] sync started, every 2 minutes')
}
