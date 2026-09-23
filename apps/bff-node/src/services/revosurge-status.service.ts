// RevoSurge 回传健康度。成功明细不落库（走 Redis 去重键），这里读的是 core-node
// 每轮同步写的心跳 + 按天按事件的计数表，用来回答三个问题：
//   还活着吗 —— 心跳超过 10 分钟没更新即异常（cron 间隔 2 分钟，留 5 倍余量）
//   发了多少 —— 今日各事件发送量，与业务量对得上就正常
//   失败多少 —— 计数表的 failed 列，明细在 bg_capi_event
// 沉默故障是这里真正要防的：cron 挂掉时既无成功也无失败记录，看起来一切正常，
// 而广告还在烧钱、对方却收不到任何转化。
import type { Redis } from 'ioredis'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { notifyRevosurgeStale, notifyRevosurgeFailing } from './admin-notify.js'

const STALE_MS = 10 * 60 * 1000

export interface RevosurgeEventCount {
  eventName: string
  sent: number
  failed: number
}

export interface RevosurgeStatus {
  /** ok=心跳新鲜且无失败；stale=心跳过期；failing=有失败 */
  health: 'ok' | 'stale' | 'failing' | 'unknown'
  lastSyncAt: string | null
  secondsSinceSync: number | null
  today: RevosurgeEventCount[]
  todaySent: number
  todayFailed: number
  recentFailures: { eventName: string; httpCode: number | null; error: string; at: string }[]
}

export async function getRevosurgeStatus(env: Env, redis: Redis): Promise<RevosurgeStatus> {
  const empty: RevosurgeStatus = {
    health: 'unknown', lastSyncAt: null, secondsSinceSync: null,
    today: [], todaySent: 0, todayFailed: 0, recentFailures: [],
  }
  if (!isMysqlEnabled(env)) return empty

  const raw = await redis.get('rs:sync:heartbeat').catch(() => null)
  const beatMs = raw ? Number(raw) : NaN
  const fresh = Number.isFinite(beatMs) && Date.now() - beatMs < STALE_MS

  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT event_name, sent, failed FROM bg_revosurge_daily
     WHERE stat_date = CURDATE() ORDER BY sent DESC`,
  )
  const today = rows.map((r) => ({
    eventName: String(r.event_name),
    sent: Number(r.sent),
    failed: Number(r.failed),
  }))
  const todaySent = today.reduce((n, r) => n + r.sent, 0)
  const todayFailed = today.reduce((n, r) => n + r.failed, 0)

  const [failRows] = await db.query<RowDataPacket[]>(
    `SELECT event_name, http_code, error, created_at FROM bg_capi_event
     WHERE platform = 'revosurge' AND status = 'failed'
     ORDER BY id DESC LIMIT 20`,
  )

  return {
    health: !Number.isFinite(beatMs) ? 'unknown' : !fresh ? 'stale' : todayFailed > 0 ? 'failing' : 'ok',
    lastSyncAt: Number.isFinite(beatMs) ? new Date(beatMs).toISOString() : null,
    secondsSinceSync: Number.isFinite(beatMs) ? Math.floor((Date.now() - beatMs) / 1000) : null,
    today,
    todaySent,
    todayFailed,
    recentFailures: failRows.map((r) => ({
      eventName: String(r.event_name),
      httpCode: r.http_code == null ? null : Number(r.http_code),
      error: String(r.error ?? ''),
      at: new Date(r.created_at as string).toISOString(),
    })),
  }
}

// ── 告警判定 ──────────────────────────────────────────────────────────────────
// 放在 bff 而不是 core-node：心跳超时的本质是 core-node 那边的 cron 停了，
// 由它自己检测等于让死人报自己的死讯，必须由另一个进程来看。

/** 失败告警的双条件：只看比率会误报——发了 2 条失败 1 条就是 50%，不值得叫醒任何人 */
const FAIL_MIN = 10
const FAIL_RATE = 0.2
/** 这些码不会自愈，必须人工介入：密钥失效、字段校验失败、事件未开通 */
const ACTIONABLE_CODES = new Set([400, 401, 403, 422])

export async function checkRevosurgeAlerts(env: Env, redis: Redis): Promise<void> {
  const st = await getRevosurgeStatus(env, redis)
  // unknown = 从未产生过心跳，通常是没配 API Key（功能整体关闭），不该告警
  if (st.health === 'unknown') return

  if (st.health === 'stale') {
    await notifyRevosurgeStale(env, { minutes: Math.floor((st.secondsSinceSync ?? 0) / 60) })
    return
  }

  const total = st.todaySent + st.todayFailed
  if (st.todayFailed < FAIL_MIN || st.todayFailed / total <= FAIL_RATE) return

  const codes = new Map<string, number>()
  for (const f of st.recentFailures) {
    const key = f.httpCode == null ? '网络/超时' : String(f.httpCode)
    codes.set(key, (codes.get(key) ?? 0) + 1)
  }
  await notifyRevosurgeFailing(env, {
    failed: st.todayFailed,
    total,
    needsAction: st.recentFailures.some((f) => f.httpCode != null && ACTIONABLE_CODES.has(f.httpCode)),
    codeSummary: [...codes].map(([c, n]) => `${c}×${n}`).join(' ') || '未知',
  })
}
