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
import { sendEvent } from '../services/revosurge.service.js'
import { forEachTenant } from '../lib/tenant-jobs.js'

const INTERVAL_MS = 2 * 60 * 1000
// 扫描窗口远大于执行间隔：任务偶发失败或重启时能自行补上，重复部分被幂等表吃掉
const LOOKBACK_MS = 30 * 60 * 1000

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

async function runOnce(app: FastifyInstance): Promise<void> {
  const db = app.mysql
  const since = new Date(Date.now() - LOOKBACK_MS)
  const [withdrawals, failedDeposits, kyc, blocked, logins] = [
    await syncWithdrawals(db, since),
    await syncFailedDeposits(db, since),
    await syncKyc(db, since),
    await syncAccountStatus(db, since),
    await syncLogins(db, since),
  ]
  if (withdrawals || failedDeposits || kyc || blocked || logins) {
    app.log.info({ withdrawals, failedDeposits, kyc, blocked, logins }, '[revosurge] synced')
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
