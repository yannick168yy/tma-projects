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
