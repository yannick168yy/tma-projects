// 广告转化服务端回传（Facebook Conversions API / TikTok Events API）。
//
// 为什么必须有服务端回传：
//   1. 博彩站的浏览器像素被拦截率极高（广告拦截插件 + iOS ITP），只靠前端会漏掉大量转化，
//      投手侧成本虚高，直接影响结算。
//   2. 充值走三方支付页，用户付完常常回不到站内，前端根本没有机会打 Purchase。
//      到账事实只有服务端知道，所以 Purchase 一律以服务端为准。
//
// 去重：event_id 与前端像素 eventID 同值（注册=userId，充值=orderId），平台按它自动合并。
// 幂等：bg_capi_event 的唯一键抢占式插入，抢不到即已发过，直接跳过（NATS 重投安全）。
import { createHash } from 'node:crypto'
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'

const FB_API_VERSION = 'v21.0'
const TIMEOUT_MS = 5000

export interface Attribution {
  fbPixelId: string | null
  ttPixelId: string | null
  clickPlatform: string
  clickId: string | null
  fbp: string | null
  fbc: string | null
  ttp: string | null
  userAgent: string | null
  clientIp: string | null
}

export async function loadAttribution(db: Pool, userId: string): Promise<Attribution | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT fb_pixel_id, tt_pixel_id, click_platform, click_id, fbp, fbc, ttp, user_agent, client_ip
     FROM bg_user_attribution WHERE user_id = ? LIMIT 1`,
    [userId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    fbPixelId: r.fb_pixel_id ?? env.FB_PIXEL_ID ?? null,
    ttPixelId: r.tt_pixel_id ?? env.TIKTOK_PIXEL_ID ?? null,
    clickPlatform: String(r.click_platform ?? 'other'),
    clickId: r.click_id ?? null,
    fbp: r.fbp ?? null,
    fbc: r.fbc ?? null,
    ttp: r.ttp ?? null,
    userAgent: r.user_agent ?? null,
    clientIp: r.client_ip ?? null,
  }
}

/** 抢占唯一键；返回 false 表示这条事件已发过（或正在发），本次跳过 */
async function claim(db: Pool, platform: string, eventName: string, eventId: string, userId: string): Promise<boolean> {
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO bg_capi_event (platform, event_name, event_id, user_id) VALUES (?,?,?,?)`,
    [platform, eventName, eventId, userId],
  )
  return res.affectedRows > 0
}

async function finish(db: Pool, platform: string, eventName: string, eventId: string, httpCode: number | null, error?: string): Promise<void> {
  await db.execute(
    `UPDATE bg_capi_event SET status = ?, http_code = ?, error = ?
     WHERE platform = ? AND event_name = ? AND event_id = ?`,
    [error ? 'failed' : 'sent', httpCode, error?.slice(0, 255) ?? null, platform, eventName, eventId],
  )
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ code: number; text: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    return { code: res.status, text: (await res.text()).slice(0, 255) }
  } finally {
    clearTimeout(timer)
  }
}

function sha256(v: string): string {
  return createHash('sha256').update(v.trim().toLowerCase()).digest('hex')
}

interface EventInput {
  userId: string
  eventName: 'CompleteRegistration' | 'Purchase'
  eventId: string
  eventTimeSec: number
  value?: number
  currency?: string
}

// 投流方各自 BM 出像素，token 不通用，必须按 (platform, pixel_id) 匹配；
// 表里没配的像素回退 env 全局 token。返回空串=没配置，调用方直接跳过（不 claim，配好后还能补发）
async function resolveToken(db: Pool, platform: 'facebook' | 'tiktok', pixelId: string): Promise<string> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT access_token FROM bg_capi_pixel_token WHERE platform = ? AND pixel_id = ? LIMIT 1`,
    [platform, pixelId],
  )
  const fromDb = rows[0]?.access_token ? String(rows[0].access_token).trim() : ''
  if (fromDb) return fromDb
  return platform === 'facebook' ? env.FB_CAPI_ACCESS_TOKEN.trim() : env.TIKTOK_CAPI_ACCESS_TOKEN.trim()
}

async function sendFacebook(db: Pool, attr: Attribution, ev: EventInput): Promise<void> {
  if (!attr.fbPixelId) return
  const token = await resolveToken(db, 'facebook', attr.fbPixelId)
  if (!token) return
  if (!(await claim(db, 'facebook', ev.eventName, ev.eventId, ev.userId))) return

  // external_id 用哈希后的 userId：即使 fbp/fbc 都丢了，同一用户的注册与充值仍能被平台串上
  const userData: Record<string, unknown> = { external_id: sha256(ev.userId) }
  if (attr.fbp) userData.fbp = attr.fbp
  if (attr.fbc) userData.fbc = attr.fbc
  if (attr.clientIp) userData.client_ip_address = attr.clientIp
  if (attr.userAgent) userData.client_user_agent = attr.userAgent

  const body: Record<string, unknown> = {
    data: [{
      event_name: ev.eventName,
      event_time: ev.eventTimeSec,
      event_id: ev.eventId,
      action_source: 'website',
      user_data: userData,
      ...(ev.value !== undefined ? { custom_data: { value: ev.value, currency: ev.currency } } : {}),
    }],
  }
  if (env.FB_CAPI_TEST_EVENT_CODE.trim()) body.test_event_code = env.FB_CAPI_TEST_EVENT_CODE.trim()

  const url = `https://graph.facebook.com/${FB_API_VERSION}/${encodeURIComponent(attr.fbPixelId)}/events?access_token=${encodeURIComponent(token)}`
  try {
    const { code, text } = await postJson(url, body)
    await finish(db, 'facebook', ev.eventName, ev.eventId, code, code >= 200 && code < 300 ? undefined : text)
  } catch (err) {
    await finish(db, 'facebook', ev.eventName, ev.eventId, null, err instanceof Error ? err.message : 'request failed')
  }
}

async function sendTiktok(db: Pool, attr: Attribution, ev: EventInput): Promise<void> {
  if (!attr.ttPixelId) return
  const token = await resolveToken(db, 'tiktok', attr.ttPixelId)
  if (!token) return
  if (!(await claim(db, 'tiktok', ev.eventName, ev.eventId, ev.userId))) return

  const user: Record<string, unknown> = { external_id: sha256(ev.userId) }
  if (attr.ttp) user.ttp = attr.ttp
  if (attr.clickPlatform === 'tiktok' && attr.clickId) user.ttclid = attr.clickId
  if (attr.clientIp) user.ip = attr.clientIp
  if (attr.userAgent) user.user_agent = attr.userAgent

  const body: Record<string, unknown> = {
    event_source: 'web',
    event_source_id: attr.ttPixelId,
    data: [{
      event: ev.eventName,
      event_time: ev.eventTimeSec,
      event_id: ev.eventId,
      user,
      ...(ev.value !== undefined ? { properties: { value: ev.value, currency: ev.currency } } : {}),
    }],
  }
  if (env.TIKTOK_CAPI_TEST_EVENT_CODE.trim()) body.test_event_code = env.TIKTOK_CAPI_TEST_EVENT_CODE.trim()

  try {
    const { code, text } = await postJson(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      body,
      { 'Access-Token': token },
    )
    // TikTok 业务错误也返回 HTTP 200，必须看 body 里的 code
    const bizOk = code >= 200 && code < 300 && /"code"\s*:\s*0\b/.test(text)
    await finish(db, 'tiktok', ev.eventName, ev.eventId, code, bizOk ? undefined : text)
  } catch (err) {
    await finish(db, 'tiktok', ev.eventName, ev.eventId, null, err instanceof Error ? err.message : 'request failed')
  }
}

async function dispatch(db: Pool, ev: EventInput): Promise<void> {
  const attr = await loadAttribution(db, ev.userId)
  if (!attr) return // 自然流量，无来源可回传
  await Promise.all([sendFacebook(db, attr, ev), sendTiktok(db, attr, ev)])
}

/** 注册转化。event_id = userId，与前端像素同值去重 */
export async function sendRegistrationConversion(db: Pool, userId: string): Promise<void> {
  await dispatch(db, {
    userId,
    eventName: 'CompleteRegistration',
    eventId: userId,
    eventTimeSec: Math.floor(Date.now() / 1000),
  })
}

/** 充值到账转化。event_id = orderId，天然唯一 */
export async function sendPurchaseConversion(
  db: Pool,
  input: { userId: string; orderId: string; amount: number; currency: string },
): Promise<void> {
  await dispatch(db, {
    userId: input.userId,
    eventName: 'Purchase',
    eventId: input.orderId,
    eventTimeSec: Math.floor(Date.now() / 1000),
    value: input.amount,
    currency: input.currency,
  })
}
