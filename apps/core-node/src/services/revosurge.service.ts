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

interface SendInput {
  userId: string
  /** RevoSurge 事件名，需在其事件目录内 */
  eventName: string
  /** 幂等键：注册=userId，充值=orderId */
  eventId: string
  /** 事件专属字段，合并进 context */
  fields?: Record<string, unknown>
}

async function send(db: Pool, input: SendInput): Promise<void> {
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

export async function sendRegisterEvent(db: Pool, userId: string): Promise<void> {
  await send(db, { userId, eventName: 'register', eventId: userId })
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
  await send(db, {
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
