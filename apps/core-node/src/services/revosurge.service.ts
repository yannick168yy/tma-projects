// RevoSurge 广告转化回传（DataPulse S2S v3）。
//
// 触发点与 FB/TikTok CAPI 相同（注册接口 + onPaidDeposit 汇合点），但去重不走
// bg_capi_event：RevoSurge 有 19 个事件，其中 bet 是每局一条，按扫描窗口 30 分钟 /
// 每 2 分钟一轮算，同一条记录会被扫到 15 次，全靠唯一键挡。那张表会以每天数十万行
// 的速度涨，而它对 RevoSurge 的价值只是「发过没有」——这用 Redis 键更合适：
//   - 带 TTL 自动过期，不需要清理任务
//   - 发送失败就删键，下一轮扫描自动重试（DB 唯一键占位后是永不重试的）
//   - 只有失败才落 bg_capi_event，排障时不用在千万行成功记录里捞
// FB/TikTok 仍走 bg_capi_event：只有 register/purchase 两个事件，量与结算对账直接相关。
//
// 归因凭据是 revosurge_click_id：落地页 ?click_id= 带入，注册时随 X-Attr 落快照。
// 查不到即非 RevoSurge 流量，直接跳过。
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { postJson } from './capi.service.js'
import { getDefaultRedis, keyPrefixFor } from '../plugins/redis.js'
import { currentTenantOrNull } from '../lib/tenant-context.js'

const API_BASE = 'https://datapulse-api.revosurge.com/v3/s2s/event'
const BATCH_URL = 'https://datapulse-api.revosurge.com/v3/s2s/batch'
const PLATFORM = 'revosurge'
// 低频事件的去重键活 7 天，足够覆盖任务长时间中断后的恢复。
const DEDUP_TTL_SEC = 7 * 24 * 3600

// bet 必须单独给短 TTL：单键实测 72 字节，按 30 万局/天算 7 天就是 210 万键约 150MB，
// 而这台 Redis maxmemory 只有 64MB 且策略是 allkeys-lru——撑爆后淘汰的不只是去重键，
// 用户 session 会被一起挤掉。而 bet 的 round_id 局一结束就固定、不可能重发，
// 扫描窗口又只有 30 分钟，2 小时已是 4 倍余量。极端情况下重发由对方按
// transaction_id 去重兜底。
const TTL_BY_EVENT: Record<string, number> = { bet: 2 * 3600 }

function ttlFor(eventName: string): number {
  return TTL_BY_EVENT[eventName] ?? DEDUP_TTL_SEC
}

// 复用租户前缀，多租户下各站的去重键互不干扰
function dedupKey(eventName: string, eventId: string): string {
  return `${keyPrefixFor(currentTenantOrNull())}rs:${eventName}:${eventId}`
}

/** 抢占去重键；false 表示这条事件已发过（或正在发），本次跳过 */
async function claimKey(eventName: string, eventId: string): Promise<boolean> {
  const res = await getDefaultRedis().set(dedupKey(eventName, eventId), '1', 'EX', ttlFor(eventName), 'NX')
  return res === 'OK'
}

/** 放弃占位，让下一轮扫描重试。Redis 不可用时静默——重试机会没了，但不该因此中断主流程 */
async function releaseKey(eventName: string, eventId: string): Promise<void> {
  await getDefaultRedis()
    .del(dedupKey(eventName, eventId))
    .catch(() => undefined)
}

// 「曾被封禁」标记。用户表只存当前状态、没有历史，而去重键 7 天就过期了，
// 判断解封需要一个活得更久的痕迹。90 天覆盖对方 30 天归因窗口还有富余。
const BLOCKED_MARK_TTL_SEC = 90 * 24 * 3600

export async function markBlocked(userId: string): Promise<void> {
  await getDefaultRedis()
    .set(`${keyPrefixFor(currentTenantOrNull())}rs:blocked_once:${userId}`, '1', 'EX', BLOCKED_MARK_TTL_SEC)
    .catch(() => undefined)
}

export async function wasBlocked(userId: string): Promise<boolean> {
  const n = await getDefaultRedis()
    .exists(`${keyPrefixFor(currentTenantOrNull())}rs:blocked_once:${userId}`)
    .catch(() => 0)
  return n > 0
}

// 日计数与心跳：成功明细不落库，但完全不记会留下沉默故障的口子——cron 挂掉时
// 既无成功也无失败记录，看起来一切正常，而广告还在烧钱。计数按天按事件聚合
// （一天最多 19 行），心跳放 Redis，两者合起来能回答「还活着吗 / 发了多少 / 失败多少」。
const HEARTBEAT_TTL_SEC = 3600

export function heartbeatKey(): string {
  return `${keyPrefixFor(currentTenantOrNull())}rs:sync:heartbeat`
}

export async function touchHeartbeat(): Promise<void> {
  await getDefaultRedis()
    .set(heartbeatKey(), String(Date.now()), 'EX', HEARTBEAT_TTL_SEC)
    .catch(() => undefined)
}

/** 按事件名分组累加，一批最多几个不同事件名，UPSERT 次数可忽略 */
async function bumpDaily(db: Pool, events: SendInput[], ok: boolean): Promise<void> {
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.eventName, (counts.get(e.eventName) ?? 0) + 1)
  const col = ok ? 'sent' : 'failed'
  for (const [name, n] of counts) {
    await db
      .execute(
        `INSERT INTO bg_revosurge_daily (stat_date, event_name, ${col}) VALUES (CURDATE(), ?, ?)
         ON DUPLICATE KEY UPDATE ${col} = ${col} + VALUES(${col})`,
        [name, n],
      )
      .catch(() => undefined)
  }
}

/** 只记失败。ON DUPLICATE 是因为同一事件重试失败会再次落到这里 */
async function logFailure(
  db: Pool,
  input: SendInput,
  httpCode: number | null,
  error: string,
): Promise<void> {
  await db
    .execute(
      `INSERT INTO bg_capi_event (platform, event_name, event_id, user_id, status, http_code, error)
       VALUES (?,?,?,?,'failed',?,?)
       ON DUPLICATE KEY UPDATE status='failed', http_code=VALUES(http_code), error=VALUES(error)`,
      [PLATFORM, input.eventName, input.eventId, input.userId, httpCode, error.slice(0, 255)],
    )
    .catch(() => undefined)
}

interface RevosurgeAttribution {
  clickId: string
  clientIp: string | null
  userAgent: string | null
}

async function loadAttribution(db: Pool, userId: string): Promise<RevosurgeAttribution | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT revosurge_click_id, client_ip, user_agent
     FROM bg_user_attribution WHERE user_id = ? LIMIT 1`,
    [userId],
  )
  const r = rows[0]
  if (!r?.revosurge_click_id) return null
  return {
    clickId: String(r.revosurge_click_id),
    clientIp: r.client_ip ?? null,
    userAgent: r.user_agent ?? null,
  }
}

export interface SendInput {
  userId: string
  /** RevoSurge 事件名，需在其事件目录内 */
  eventName: string
  /** 去重键：注册=userId，充值=orderId，状态类事件=userId:变更时间戳 */
  eventId: string
  /** 事件专属字段，合并进 context */
  fields?: Record<string, unknown>
}

function buildBody(input: SendInput, attr: RevosurgeAttribution): Record<string, unknown> {
  const context: Record<string, unknown> = { ...input.fields }
  // ip_address 是必填项，且 RevoSurge 用它解析国家/城市做地域归因
  if (attr.clientIp) context.ip_address = attr.clientIp
  if (attr.userAgent) context.user_agent = attr.userAgent
  return {
    event: input.eventName,
    // 必须是 13 位毫秒，秒级会被 not_milliseconds 规则拒掉
    timestamp: Date.now(),
    identity: { client_user_id: input.userId, click_id: attr.clickId },
    context,
  }
}

export async function sendEvent(db: Pool, input: SendInput): Promise<void> {
  if (!env.REVOSURGE_API_KEY.trim()) return
  const attr = await loadAttribution(db, input.userId)
  if (!attr) return
  if (!(await claimKey(input.eventName, input.eventId))) return

  const url = env.REVOSURGE_DRYRUN.trim() === 'true' ? `${API_BASE}?dryrun=1` : API_BASE
  try {
    const { code, text } = await postJson(url, buildBody(input, attr), {
      'X-API-KEY': env.REVOSURGE_API_KEY.trim(),
    })
    // 正式入库返回 202，dryrun 返回 200
    if (code >= 200 && code < 300) {
      await bumpDaily(db, [input], true)
      return
    }
    await releaseKey(input.eventName, input.eventId)
    await logFailure(db, input, code, text)
    await bumpDaily(db, [input], false)
  } catch (err) {
    await releaseKey(input.eventName, input.eventId)
    await logFailure(db, input, null, err instanceof Error ? err.message : 'request failed')
    await bumpDaily(db, [input], false)
  }
}

// 对方批量接口硬上限 600（超了返回 BATCH_TOO_LARGE），留余量
const BATCH_CHUNK = 500

/**
 * 批量上报。所有事件都必须走这里：对方限流 300 次/分钟，而单条发送时一轮扫描
 * 最坏能产生数千次请求，必然超限。批量后每 500 条才占 1 次配额。
 * 超过分片上限自动拆批，调用方不用关心条数。
 */
export async function sendEventBatch(db: Pool, inputs: SendInput[]): Promise<number> {
  if (!env.REVOSURGE_API_KEY.trim() || !inputs.length) return 0
  if (inputs.length > BATCH_CHUNK) {
    let sent = 0
    for (let i = 0; i < inputs.length; i += BATCH_CHUNK) {
      sent += await sendEventBatch(db, inputs.slice(i, i + BATCH_CHUNK))
    }
    return sent
  }

  const userIds = [...new Set(inputs.map((i) => i.userId))]
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, revosurge_click_id, client_ip, user_agent
     FROM bg_user_attribution
     WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND revosurge_click_id IS NOT NULL`,
    userIds,
  )
  const attrs = new Map<string, RevosurgeAttribution>()
  for (const r of rows) {
    attrs.set(String(r.user_id), {
      clickId: String(r.revosurge_click_id),
      clientIp: r.client_ip ?? null,
      userAgent: r.user_agent ?? null,
    })
  }

  const claimed: SendInput[] = []
  const bodies: unknown[] = []
  for (const input of inputs) {
    const attr = attrs.get(input.userId)
    if (!attr) continue
    if (!(await claimKey(input.eventName, input.eventId))) continue
    claimed.push(input)
    bodies.push(buildBody(input, attr))
  }
  if (!claimed.length) return 0

  const url = env.REVOSURGE_DRYRUN.trim() === 'true' ? `${BATCH_URL}?dryrun=1` : BATCH_URL
  try {
    const { code, text } = await postJson(url, bodies, { 'X-API-KEY': env.REVOSURGE_API_KEY.trim() })
    // 整批级别判定：逐条对账要按 requestId 下标拆响应，收益不抵复杂度。
    // 整批算失败即全部释放键，下一轮扫描会重来——重发的那部分由对方按 transaction_id 去重
    const ok = code >= 200 && code < 300 && !/"failureCount"\s*:\s*[1-9]/.test(text)
    if (ok) {
      await bumpDaily(db, claimed, true)
      return claimed.length
    }
    for (const input of claimed) {
      await releaseKey(input.eventName, input.eventId)
      await logFailure(db, input, code, text)
    }
    await bumpDaily(db, claimed, false)
    return 0
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'request failed'
    for (const input of claimed) {
      await releaseKey(input.eventName, input.eventId)
      await logFailure(db, input, null, msg)
    }
    await bumpDaily(db, claimed, false)
    return 0
  }
}

export async function sendRegisterEvent(db: Pool, userId: string): Promise<void> {
  await sendEvent(db, { userId, eventName: 'register', eventId: userId })
}

/**
 * 充值到账。金额按原币种原值上报——RevoSurge 侧自行折算美元（响应里回显
 * revosurge_source_amount / target_amount / exchange_rate），不需要我们换。
 * context.transaction_id 传订单号即为其去重键，同一订单重发不会重复计数。
 */
export async function sendDepositEvent(
  db: Pool,
  input: { userId: string; orderId: string; amount: number; currency: string },
): Promise<void> {
  await sendEvent(db, {
    userId: input.userId,
    eventName: 'deposit',
    eventId: input.orderId,
    fields: {
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      transaction_id: input.orderId,
    },
  })
}
