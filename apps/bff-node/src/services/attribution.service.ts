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

// ── 站外 APK 安装配对：浏览器点下载 → 落 bg_pending_install，App 首启按 IP+机型 认领 ──

/**
 * 从 UA 提取「android主版本|机型」——仅作前端设备键缺失时的降级。
 * Chrome 110+ 的 HTTP UA 冻结为 "Android 10; K"（所有设备一样），这种冻结值配不上
 * WebView 侧的真实机型，必须拒收；正路是前端用 UA-CH 高熵接口算好键随 body 上报。
 */
export function deviceKeyFromUa(ua: string | undefined): string | null {
  const m = /Android ([\d.]+); ([^;)]+)/.exec(ua ?? '')
  if (!m) return null
  const model = m[2].replace(/ Build\/.*$/, '').trim().toLowerCase()
  if (!model || model === 'k') return null
  return `${m[1].split('.')[0]}|${model}`.slice(0, 128)
}

/** 校验前端上报的设备键：Android「主版本|机型」或 iOS「ios主版本|屏宽x屏高xDPR」，防脏数据 */
function normalizeClientDeviceKey(dk: unknown): string | null {
  if (typeof dk !== 'string') return null
  const s = dk.trim().toLowerCase().slice(0, 128)
  return /^(?:ios)?\d{1,3}\|.{1,120}$/.test(s) ? s : null
}

const MAX_ATTR_JSON = 2000

export async function savePendingInstall(
  env: Env,
  attr: unknown,
  ctx: { ip?: string; userAgent?: string; deviceKey?: unknown },
): Promise<boolean> {
  if (!isMysqlEnabled(env)) return false
  const key = normalizeClientDeviceKey(ctx.deviceKey) ?? deviceKeyFromUa(ctx.userAgent)
  if (!key || !ctx.ip) return false
  if (!attr || typeof attr !== 'object' || Array.isArray(attr)) return false
  const json = JSON.stringify(attr)
  if (json.length > MAX_ATTR_JSON) return false
  const db = getMysqlPool(env)
  // 同设备重复点下载只留最新一条：既防表膨胀，也让认领无歧义
  await db.execute(
    'DELETE FROM bg_pending_install WHERE client_ip = ? AND device_key = ? AND matched_at IS NULL',
    [ctx.ip, key],
  )
  await db.execute(
    'INSERT INTO bg_pending_install (attr_json, client_ip, device_key, user_agent) VALUES (?,?,?,?)',
    [json, ctx.ip, key, str(ctx.userAgent, 255)],
  )
  return true
}

/**
 * App 首启认领：24h 窗内按设备键找候选，同 IP 的优先。
 * CGNAT/VPN 下「点下载」与「App 首启」两次请求出口 IP 常不同（真机实测已踩），
 * 所以 IP 不作硬条件：没有同 IP 候选时，若该设备键在窗内全库唯一（无歧义）也认领；
 * 有多条不同 IP 候选才放弃——宁可漏归因，不错归因。竞态由 UPDATE 条件兜住。
 */
export async function matchPendingInstall(
  env: Env,
  ctx: { ip?: string; userAgent?: string; deviceKey?: unknown },
): Promise<AttrPayload | null> {
  if (!isMysqlEnabled(env)) return null
  const key = normalizeClientDeviceKey(ctx.deviceKey) ?? deviceKeyFromUa(ctx.userAgent)
  if (!key || !ctx.ip) return null
  const db = getMysqlPool(env)
  const [rows] = await db.query(
    `SELECT id, attr_json, client_ip FROM bg_pending_install
      WHERE device_key = ? AND matched_at IS NULL
        AND created_at > NOW(3) - INTERVAL 24 HOUR
      ORDER BY id DESC LIMIT 5`,
    [key],
  )
  const list = rows as { id: number; attr_json: string; client_ip: string }[]
  const row = list.find((r) => r.client_ip === ctx.ip) ?? (list.length === 1 ? list[0] : undefined)
  if (!row) return null
  const [res] = await db.execute(
    'UPDATE bg_pending_install SET matched_at = NOW(3) WHERE id = ? AND matched_at IS NULL',
    [row.id],
  )
  if ((res as { affectedRows: number }).affectedRows === 0) return null
  try {
    return JSON.parse(row.attr_json) as AttrPayload
  } catch {
    return null
  }
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
