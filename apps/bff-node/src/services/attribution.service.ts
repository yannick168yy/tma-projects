// 买量归因入库：前端 X-Attr 头（base64 JSON）→ bg_user_attribution，只在新注册时写一次。
// 落库后通知 core-node 发注册转化事件（CAPI）。全链路非致命，任何一步失败都不影响注册成功。
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'

interface AttrPayload {
  c?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  plat?: string
  clid?: string
  fbp?: string
  fbc?: string
  ttp?: string
  px?: string
  tpx?: string
  lh?: string
  lp?: string
  ref?: string
}

const PLATFORMS = new Set(['facebook', 'tiktok', 'google', 'other'])

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

/** 解析请求头；非法/缺失一律返回 null，调用方直接跳过 */
export function parseAttrHeader(raw: string | undefined): AttrPayload | null {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8')
    const obj = JSON.parse(json) as unknown
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    return obj as AttrPayload
  } catch {
    return null
  }
}

export async function saveUserAttribution(
  env: Env,
  userId: string,
  attr: AttrPayload,
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  if (!isMysqlEnabled(env)) return
  const platform = attr.plat && PLATFORMS.has(attr.plat) ? attr.plat : 'other'
  const db = getMysqlPool(env)
  // INSERT IGNORE 而非 ON DUPLICATE：first-touch 语义，同一 user 只认第一条
  await db.execute(
    `INSERT IGNORE INTO bg_user_attribution
       (user_id, channel_code, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        click_platform, click_id, fbp, fbc, ttp, fb_pixel_id, tt_pixel_id,
        landing_host, landing_path, referrer, user_agent, client_ip)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      str(attr.c, 64),
      str(attr.utm_source, 128),
      str(attr.utm_medium, 128),
      str(attr.utm_campaign, 191),
      str(attr.utm_content, 191),
      str(attr.utm_term, 191),
      platform,
      str(attr.clid, 255),
      str(attr.fbp, 128),
      str(attr.fbc, 255),
      str(attr.ttp, 128),
      str(attr.px, 32),
      str(attr.tpx, 32),
      str(attr.lh, 191),
      str(attr.lp, 255),
      str(attr.ref, 255),
      str(ctx.userAgent, 255),
      str(ctx.ip, 45),
    ],
  )
}

/** 通知 core-node 发注册转化事件。core 侧再读 bg_user_attribution 决定发不发、发给谁 */
async function notifyRegistrationConversion(env: Env, userId: string): Promise<void> {
  if (!env.INTERNAL_TOKEN.trim()) return
  await fetch(`${env.CORE_NODE_URL}/internal/capi/registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': env.INTERNAL_TOKEN },
    body: JSON.stringify({ userId }),
  })
}

/**
 * 新注册用户的完整归因动作：落库 + 发注册转化。
 * 无 X-Attr 头时（自然流量）也要走一遍——core 侧查不到归因会自己跳过。
 */
export function captureAdAttribution(
  env: Env,
  isNewUser: boolean,
  userId: string,
  raw: { attrHeader?: string; ip?: string; userAgent?: string },
): void {
  if (!isNewUser) return
  const attr = parseAttrHeader(raw.attrHeader)
  const run = async () => {
    if (attr) await saveUserAttribution(env, userId, attr, raw)
    await notifyRegistrationConversion(env, userId)
  }
  run().catch(() => {})
}
