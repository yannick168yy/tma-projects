import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getAdminSetting, setAdminSetting } from './admin-store.js'
import {
  appDomainsForMarket, defaultAppDomainsForMarket, getSiteDomainMappings, type SiteMarket,
} from './site-domain.service.js'
import { signRoutes } from './app-route-sign.service.js'

export const TG_ROUTE_CHANNEL_KEY = 'app_route_tg_channel'
/** App 在正文里按这个前缀找载荷；改了等于让已发布的 App 认不出来，要改必须升版本号 */
export const TG_ROUTE_MARKER = 'BETOGO-ROUTES-V1:'

const MARKETS: SiteMarket[] = ['PH', 'ID']

export async function getRouteChannel(env: Env): Promise<string> {
  return (await getAdminSetting(env, TG_ROUTE_CHANNEL_KEY))?.trim() ?? ''
}

export async function saveRouteChannel(env: Env, value: string): Promise<string> {
  const channel = value.trim()
  // 允许留空表示不启用；填了就必须是 @频道名，App 靠它拼 https://t.me/s/<name>
  if (channel && !/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(channel)) {
    throw new Error('频道名格式应为 @xxx（5-32 位字母数字下划线，字母开头）')
  }
  await setAdminSetting(env, TG_ROUTE_CHANNEL_KEY, channel)
  return channel
}

/**
 * 线路全被封时 App 无处获取新域名 —— 这条 Telegram 公开频道是最后一条命。
 * 载荷带的是与 /app/bootstrap 同一把私钥的签名，所以频道即使被冒名顶替，
 * 攻击者也伪造不出线路表；App 读 t.me 网页版即可，不需要 bot token。
 */
export async function buildRoutePayload(redis: Redis, env: Env): Promise<string> {
  const mappings = await getSiteDomainMappings(redis, env)
  const issuedAt = Math.floor(Date.now() / 1000)
  const body: Record<string, unknown> = {}
  for (const market of MARKETS) {
    const configured = appDomainsForMarket(mappings, market)
    const domains = (configured.length > 0 ? configured : defaultAppDomainsForMarket(market))
      .map((item) => ({ domain: item.domain, priority: item.appPriority }))
    body[market] = { domains, issuedAt, signature: signRoutes(env, market, domains, issuedAt) }
  }
  return TG_ROUTE_MARKER + Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
}

export async function publishRoutesToTelegram(
  redis: Redis, env: Env,
): Promise<{ channel: string; messageId: number }> {
  const channel = await getRouteChannel(env)
  if (!channel) throw new Error('未配置 Telegram 线路频道')
  const token = env.ADMIN_TG_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('未配置 Telegram bot token')

  const payload = await buildRoutePayload(redis, env)
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 不加 parse_mode：载荷是 base64，Markdown/HTML 解析可能吃掉字符导致 App 验签失败
    body: JSON.stringify({ chat_id: channel, text: payload, disable_web_page_preview: true }),
  })
  const data = await resp.json().catch(() => ({})) as { ok?: boolean; description?: string; result?: { message_id?: number } }
  if (!data.ok) throw new Error(data.description || 'Telegram 发布失败')
  return { channel, messageId: Number(data.result?.message_id ?? 0) }
}
