// RevoSurge 广告转化回传（DataPulse S2S v3）。
//
// 与 FB/TikTok CAPI 的关系：同一套触发点、同一张幂等表（bg_capi_event，platform='revosurge'），
// 只是收件方不同。挂在一起的理由和 capi.service 一样——充值走三方支付页，用户付完常回不到站内，
// 前端根本没机会上报，到账事实只有服务端知道。
//
// 归因凭据是 revosurge_click_id：落地页 ?click_id= 带入，注册时随 X-Attr 落快照。
// 查不到即非 RevoSurge 流量，直接跳过。
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { claim, finish, postJson } from './capi.service.js'

const API_BASE = 'https://datapulse-api.revosurge.com/v3/s2s/event'
const BATCH_URL = 'https://datapulse-api.revosurge.com/v3/s2s/batch'
const PLATFORM = 'revosurge'

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
  /** 幂等键：注册=userId，充值=orderId，状态类事件=userId:变更时间戳 */
  eventId: string
  /** 事件专属字段，合并进 context */
  fields?: Record<string, unknown>
}

export async function sendEvent(db: Pool, input: SendInput): Promise<void> {
  if (!env.REVOSURGE_API_KEY.trim()) return
  const attr = await loadAttribution(db, input.userId)
  if (!attr) return
  if (!(await claim(db, PLATFORM, input.eventName, input.eventId, input.userId))) return

  const context: Record<string, unknown> = { ...input.fields }
  // ip_address 是必填项，且 RevoSurge 用它解析国家/城市做地域归因
  if (attr.clientIp) context.ip_address = attr.clientIp
  if (attr.userAgent) context.user_agent = attr.userAgent

  const body = {
    event: input.eventName,
    // 必须是 13 位毫秒，秒级会被 not_milliseconds 规则拒掉
    timestamp: Date.now(),
    identity: { client_user_id: input.userId, click_id: attr.clickId },
    context,
  }

  const url = env.REVOSURGE_DRYRUN.trim() === 'true' ? `${API_BASE}?dryrun=1` : API_BASE
  try {
    const { code, text } = await postJson(url, body, { 'X-API-KEY': env.REVOSURGE_API_KEY.trim() })
    // 正式入库返回 202，dryrun 返回 200
    await finish(db, PLATFORM, input.eventName, input.eventId, code, code >= 200 && code < 300 ? undefined : text)
  } catch (err) {
    await finish(db, PLATFORM, input.eventName, input.eventId, null, err instanceof Error ? err.message : 'request failed')
  }
}

/**
 * 批量上报。bet 这类高频事件按单条发会被网络往返拖死——500 条就是 500 次 HTTP。
 * 这里把慢的部分（HTTP）合成一次，快的部分（claim/finish 走本地 MySQL）仍逐条，
 * 幂等语义与单条完全一致。批量上限 600 是对方的硬限制，超了返回 BATCH_TOO_LARGE。
 */
export async function sendEventBatch(db: Pool, inputs: SendInput[]): Promise<number> {
  if (!env.REVOSURGE_API_KEY.trim() || !inputs.length) return 0

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
    if (!(await claim(db, PLATFORM, input.eventName, input.eventId, input.userId))) continue
    const context: Record<string, unknown> = { ...input.fields }
    if (attr.clientIp) context.ip_address = attr.clientIp
    if (attr.userAgent) context.user_agent = attr.userAgent
    claimed.push(input)
    bodies.push({
      event: input.eventName,
      timestamp: Date.now(),
      identity: { client_user_id: input.userId, click_id: attr.clickId },
      context,
    })
  }
  if (!claimed.length) return 0

  const url = env.REVOSURGE_DRYRUN.trim() === 'true' ? `${BATCH_URL}?dryrun=1` : BATCH_URL
  try {
    const { code, text } = await postJson(url, bodies, { 'X-API-KEY': env.REVOSURGE_API_KEY.trim() })
    // 整批级别判定：逐条对账要按 requestId 下标拆响应，收益不抵复杂度——
    // 失败的那批下次扫描不会重发（claim 已占位），与单条路径的取舍保持一致
    const ok = code >= 200 && code < 300 && !/"failureCount"\s*:\s*[1-9]/.test(text)
    for (const input of claimed) {
      await finish(db, PLATFORM, input.eventName, input.eventId, code, ok ? undefined : text)
    }
    return ok ? claimed.length : 0
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'request failed'
    for (const input of claimed) {
      await finish(db, PLATFORM, input.eventName, input.eventId, null, msg)
    }
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
