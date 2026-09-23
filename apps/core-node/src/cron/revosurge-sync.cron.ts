// RevoSurge 二期事件同步：提现 / 充值失败 / KYC / 封禁 / 登录。
//
// 为什么用扫表而不是挂业务触发点：这些状态的写入点是散的——提现 completed 就有 5 处
// （4 个支付回调 + 管理后台审核，还横跨 bff 的 Redis 路径），挨个挂必漏。扫 updated_at
// 增量则只有一个入口，漏发的风险从「改代码时忘了挂」降为零。
//
// 幂等由 Redis 去重键兜底（见 revosurge.service），所以窗口可以放宽重叠扫描：
// 某次任务失败，下一轮照样能补上，重复扫到的会被去重键挡住。
//
// 所有事件一律走 sendEventBatch：对方限流 300 次/分钟，逐条发时一轮扫描最坏能产生
// 数千次请求，必然超限；批量后每类事件只占 1-2 次配额，一轮十几次就够。
//
// 注册与充值不在这里——那两个有唯一汇合点，走实时回传（capi 的触发点旁边）。
import type { FastifyInstance } from 'fastify'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { sendEventBatch, markBlocked, wasBlocked, touchHeartbeat, type SendInput } from '../services/revosurge.service.js'
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
  return sendEventBatch(
    db,
    rows.map((r) => ({
      userId: String(r.user_id),
      eventName: 'withdraw',
      eventId: String(r.order_id),
      fields: {
        amount: Number(r.amount),
        currency: String(r.currency ?? 'PHP').toUpperCase(),
        transaction_id: String(r.order_id),
      },
    })),
  )
}

async function syncFailedDeposits(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, amount, currency, channel FROM bg_deposit_order
     WHERE status IN ('failed','rejected','admin_rejected') AND updated_at >= ? LIMIT 500`,
    [since],
  )
  return sendEventBatch(
    db,
    rows.map((r) => ({
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
    })),
  )
}

async function syncKyc(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, status, reviewed_at, updated_at FROM bg_kyc
     WHERE status IN ('approved','rejected') AND updated_at >= ? LIMIT 500`,
    [since],
  )
  return sendEventBatch(
    db,
    rows.map((r) => {
      const approved = String(r.status) === 'approved'
      return {
        userId: String(r.user_id),
        eventName: approved ? 'kyc_completed' : 'kyc_rejected',
        eventId: stateEventId(String(r.user_id), r.reviewed_at ?? r.updated_at),
        fields: {
          jurisdiction: env.REVOSURGE_JURISDICTION.trim().toUpperCase(),
          kyc_level: 'basic',
          // 我方只有单级实名、且只走证件，其余枚举值用不上
          ...(approved ? { verification_method: 'id_document' } : { rejection_reason: 'other' }),
        },
      }
    }),
  )
}

async function syncAccountStatus(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, status, updated_at FROM bg_user
     WHERE status = 'banned' AND updated_at >= ? LIMIT 500`,
    [since],
  )
  const sent = await sendEventBatch(
    db,
    rows.map((r) => ({
      userId: String(r.id),
      eventName: 'account_blocked',
      eventId: stateEventId(String(r.id), r.updated_at),
      // 我方封禁原因是自由文本，映射不进其枚举，统一报 other
      fields: { block_reason: 'other' },
    })),
  )
  for (const r of rows) await markBlocked(String(r.id))
  return sent
}

/** 登录按「每人每天一条」收敛：原样上报量太大且没有额外信息量，日活信号一条就够 */
async function syncLogins(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, DATE_FORMAT(created_at,'%Y-%m-%d') d FROM bg_login_log
     WHERE created_at >= ? GROUP BY user_id, DATE_FORMAT(created_at,'%Y-%m-%d') LIMIT 1000`,
    [since],
  )
  return sendEventBatch(
    db,
    rows.map((r) => ({
      userId: String(r.user_id),
      eventName: 'login',
      eventId: `${r.user_id}:${String(r.d)}`,
    })),
  )
}

/** App 启动。bg_login_log.platform='app' 即 APK 环境（我方只有 Android 包，无 iOS）。
 *  install 用 userId 当幂等键——首次扫到即发、之后被 claim 挡掉；open 收敛成每人每天一条。
 *  app_uninstall 没做：卸载后客户端已经发不出请求，要靠推送 token 失效反推，我方无此链路。 */
async function syncAppEvents(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT user_id, DATE_FORMAT(created_at,'%Y-%m-%d') d FROM bg_login_log
     WHERE platform = 'app' AND created_at >= ? LIMIT 500`,
    [since],
  )
  return sendEventBatch(
    db,
    rows.flatMap((r) => {
      const userId = String(r.user_id)
      return [
        { userId, eventName: 'app_install', eventId: userId, fields: { platform: 'android' } },
        {
          userId,
          eventName: 'app_open',
          eventId: `${userId}:${String(r.d)}`,
          fields: { platform: 'android' },
        },
      ]
    }),
  )
}

/** 充值发起。订单一建立即为发起，与到账的 deposit 是两条事件——
 *  两者的差额正是支付流失，对方的模型要靠这个识别支付环节的问题。 */
async function syncInitiatedDeposits(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, amount, currency FROM bg_deposit_order
     WHERE created_at >= ? LIMIT 500`,
    [since],
  )
  return sendEventBatch(
    db,
    rows.map((r) => ({
      userId: String(r.user_id),
      eventName: 'deposit_initiated',
      eventId: String(r.order_id),
      fields: {
        amount: Number(r.amount),
        currency: String(r.currency ?? 'PHP').toUpperCase(),
        transaction_id: String(r.order_id),
      },
    })),
  )
}

/** 解封。用户表只有当前状态判断不出「曾被封过」，靠封禁时打的 Redis 标记来筛——
 *  没被封过的用户转 active 只是普通状态变动，不该报解封。 */
async function syncUnblocked(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, updated_at FROM bg_user
     WHERE status = 'active' AND updated_at >= ? LIMIT 500`,
    [since],
  )
  const targets: SendInput[] = []
  for (const r of rows) {
    if (!(await wasBlocked(String(r.id)))) continue
    targets.push({
      userId: String(r.id),
      eventName: 'account_unblocked',
      eventId: stateEventId(String(r.id), r.updated_at),
      fields: { unblock_reason: 'other' },
    })
  }
  return sendEventBatch(db, targets)
}

/**
 * 优惠奖金生命周期。我方的 bg_turnover_requirements 就是流水要求表，
 * source_type='promotion' 的那批即奖金——记录一建立就说明用户已领到，
 * status 推进到 completed 即流水打满。
 *
 * 对方目录里还有 bonus_offered（已展示未领取）和 bonus_cashed_out（奖金提现），
 * 我方没有这两个业务状态，不硬凑。
 */
async function syncBonuses(db: Pool, since: Date): Promise<number> {
  const [claimed] = await db.query<RowDataPacket[]>(
    `SELECT id, user_id, source_ref, base_amount, required_amount, currency
     FROM bg_turnover_requirements
     WHERE source_type = 'promotion' AND created_at >= ? LIMIT 500`,
    [since],
  )
  const events: SendInput[] = claimed.map((r) => ({
    userId: String(r.user_id),
    eventName: 'bonus_claimed',
    eventId: String(r.id),
    fields: {
      bonus_id: String(r.source_ref ?? 'promotion'),
      bonus_value_granted: Number(r.base_amount),
      currency: String(r.currency ?? 'PHP').toUpperCase(),
      wagering_requirement: Number(r.required_amount),
    },
  }))

  const [completed] = await db.query<RowDataPacket[]>(
    `SELECT id, user_id, source_ref, completed_amount, required_amount, currency,
            TIMESTAMPDIFF(MINUTE, created_at, updated_at) minutes
     FROM bg_turnover_requirements
     WHERE source_type = 'promotion' AND status = 'completed' AND updated_at >= ? LIMIT 500`,
    [since],
  )
  for (const r of completed) {
    events.push({
      userId: String(r.user_id),
      eventName: 'bonus_completed',
      eventId: String(r.id),
      fields: {
        bonus_id: String(r.source_ref ?? 'promotion'),
        currency: String(r.currency ?? 'PHP').toUpperCase(),
        total_wagered: Number(r.completed_amount),
        wagering_requirement: Number(r.required_amount),
        time_to_complete_minutes: Number(r.minutes ?? 0),
      },
    })
  }
  return sendEventBatch(db, events)
}

/** VIP 等级变化。表里只存当前状态没有历史，用「userId:等级」当幂等键——
 *  升到新等级才是新键，同一等级内 updated_at 因流水累计频繁变动也不会重发。
 *  我方 VIP 按季度流水累计，实际只升不降，direction 固定 upgrade。 */
async function syncVipChanges(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, current_level FROM bg_user_vip_state
     WHERE current_level > 0 AND updated_at >= ? LIMIT 500`,
    [since],
  )
  return sendEventBatch(
    db,
    rows.map((r) => ({
      userId: String(r.user_id),
      eventName: 'vip_tier_changed',
      eventId: `${r.user_id}:${r.current_level}`,
      fields: { direction: 'upgrade', new_tier: String(r.current_level) },
    })),
  )
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
  return sendEventBatch(
    db,
    rows.map((r) => ({
      userId: String(r.user_id),
      eventName: String(r.auth_method) === 'google' ? 'email_verified' : 'phone_verified',
      eventId: String(r.user_id),
    })),
  )
}

/** 推荐注册。这是与 register 并列的独立事件（对方目录里就分两个），所以带推荐人的
 *  用户会有两条注册类事件——广告流量几乎不会带推荐人，实际触发量接近零。 */
async function syncReferralRegisters(db: Pool, since: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM bg_user WHERE inviter_id IS NOT NULL AND created_at >= ? LIMIT 500`,
    [since],
  )
  return sendEventBatch(
    db,
    rows.map((r) => ({ userId: String(r.id), eventName: 'referral_register', eventId: String(r.id) })),
  )
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
  const stats = {
    withdrawals: await syncWithdrawals(db, since),
    initiatedDeposits: await syncInitiatedDeposits(db, since),
    failedDeposits: await syncFailedDeposits(db, since),
    kyc: await syncKyc(db, since),
    blocked: await syncAccountStatus(db, since),
    unblocked: await syncUnblocked(db, since),
    logins: await syncLogins(db, since),
    bets: await syncBets(db, since),
    verified: await syncVerifications(db, since),
    referrals: await syncReferralRegisters(db, since),
    bonuses: await syncBonuses(db, since),
    vip: await syncVipChanges(db, since),
    appEvents: await syncAppEvents(db, since),
  }
  // 心跳每轮都打，与是否有数据无关——没数据不代表没在跑，监控要能区分这两者
  await touchHeartbeat()
  if (Object.values(stats).some((n) => n > 0)) {
    app.log.info(stats, '[revosurge] synced')
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
