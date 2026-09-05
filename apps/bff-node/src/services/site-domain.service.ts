import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getAdminSetting, setAdminSetting } from './admin-store.js'
import { currentTenantOrNull } from '../lib/tenant-context.js'

export type SiteMarket = 'PH' | 'ID'
export type SiteDomainTarget = SiteMarket | 'PUBLIC'
export interface SiteDomainMapping {
  domain: string
  market: SiteDomainTarget
  enabled: boolean
  appMarket: SiteMarket | null
  appPriority: number
}

export const SITE_DOMAIN_MAPPINGS_KEY = 'site_domain_mappings'
const CACHE_KEY = 'config:site-domain-mappings'
const CACHE_TTL_SECONDS = 300
// 降级配置只短缓存，避免一次 DB 抖动把兜底结果钉住整整 5 分钟
const FALLBACK_CACHE_TTL_SECONDS = 30

// 与 212 迁移的线路组同源。MARKET_DOMAIN_MAP 只有 domain->market，没有 App 线路组，
// 只靠它兜底会让 /app/bootstrap 返回空数组 —— DB 抖一下就是全量 App 冷启动白屏。
const DEFAULT_APP_DOMAINS: Record<SiteMarket, Array<{ domain: string; appPriority: number }>> = {
  PH: [
    { domain: 'betogo.games', appPriority: 10 },
    { domain: 'betogo666.com', appPriority: 20 },
    { domain: 'betogo777.com', appPriority: 30 },
  ],
  ID: [
    { domain: 'betogo.app', appPriority: 10 },
    { domain: 'betogo.xyz', appPriority: 20 },
    { domain: 'betogo.vip', appPriority: 30 },
  ],
}

function normalizeDomain(value: string): string {
  const raw = value.trim().toLowerCase()
  if (!raw) return ''
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function normalizeSiteDomainMappings(value: unknown): SiteDomainMapping[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: SiteDomainMapping[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const domain = normalizeDomain(String(row.domain ?? ''))
    const market = String(row.market ?? '').toUpperCase()
    if (!domain || (market !== 'PH' && market !== 'ID' && market !== 'PUBLIC') || seen.has(domain)) continue
    seen.add(domain)
    const rawAppMarket = String(row.appMarket ?? '').toUpperCase()
    const appMarket = rawAppMarket === 'PH' || rawAppMarket === 'ID' ? rawAppMarket : null
    const rawPriority = Number(row.appPriority)
    const appPriority = Number.isInteger(rawPriority) && rawPriority >= 1 && rawPriority <= 999 ? rawPriority : 100
    result.push({ domain, market, enabled: row.enabled !== false, appMarket, appPriority })
  }
  return result
}

function defaultAppFields(domain: string): { appMarket: SiteMarket | null; appPriority: number } {
  for (const market of ['PH', 'ID'] as const) {
    const hit = DEFAULT_APP_DOMAINS[market].find((item) => item.domain === domain)
    if (hit) return { appMarket: market, appPriority: hit.appPriority }
  }
  return { appMarket: null, appPriority: 100 }
}

function envMappings(env: Env): SiteDomainMapping[] {
  try {
    const parsed = JSON.parse(env.MARKET_DOMAIN_MAP) as Record<string, string>
    return normalizeSiteDomainMappings(Object.entries(parsed)
      .map(([domain, market]) => ({ domain, market, enabled: true, ...defaultAppFields(normalizeDomain(domain)) })))
  } catch {
    return []
  }
}

export async function getSiteDomainMappings(redis: Redis, env: Env): Promise<SiteDomainMapping[]> {
  const cached = await redis.get(CACHE_KEY)
  if (cached) {
    try { return normalizeSiteDomainMappings(JSON.parse(cached)) } catch { /* 读取数据库 */ }
  }
  let mappings: SiteDomainMapping[] = []
  try {
    const raw = await getAdminSetting(env, SITE_DOMAIN_MAPPINGS_KEY)
    if (raw) mappings = normalizeSiteDomainMappings(JSON.parse(raw))
  } catch {
    mappings = []
  }
  const fromDb = mappings.length > 0
  // env 里的 MARKET_DOMAIN_MAP 是**自营站**的域名表。租户库还没配域名映射时回落到它，
  // 等于把客户 App 的线路表填成自营站的域名，把人家的用户送去别家站点。
  // 线上实测过这条路径（demo1 的 /app/bootstrap 返回 betogo.games），所以只有自营站
  // 与无租户上下文（平台库挂了的降级态）才允许吃这个兜底。
  const tenant = currentTenantOrNull()
  if (!fromDb && (!tenant || tenant.selfOperated)) mappings = envMappings(env)
  await redis.set(CACHE_KEY, JSON.stringify(mappings), 'EX', fromDb ? CACHE_TTL_SECONDS : FALLBACK_CACHE_TTL_SECONDS)
  return mappings
}

/**
 * 保存前挡住两类静默误配：
 * 1. appMarket 与 market 不一致 —— 后台看着像配了 App 线路，实际被 appDomainsForMarket 过滤掉；
 * 2. 某个市场一条启用线路都不剩 —— App 探活全失败，该市场全量客户端起不来。
 */
function assertAppGroupsUsable(mappings: SiteDomainMapping[]): void {
  const mismatched = mappings.filter((item) => item.appMarket && item.appMarket !== item.market)
  if (mismatched.length > 0) {
    throw new Error(`以下域名的 App 域名组与所属站点不一致，对 App 不会生效：${mismatched.map((item) => item.domain).join('、')}`)
  }
  // 只校验「声明过 App 线路」的市场，不写死 PH/ID：包网租户可能只开一个市场，
  // 写死会让它连域名映射都保存不了。把某市场最后一条线路停用仍会被挡下（行还在、
  // appMarket 还写着），真正想去掉该市场的 App 得先把这些行的 appMarket 清空。
  const declared = new Set(mappings.map((item) => item.appMarket).filter((m): m is SiteMarket => !!m))
  for (const market of declared) {
    if (appDomainsForMarket(mappings, market).length === 0) {
      throw new Error(`${market} App 至少要保留一个启用的线路域名`)
    }
  }
}

export async function saveSiteDomainMappings(redis: Redis, env: Env, value: unknown): Promise<SiteDomainMapping[]> {
  const mappings = normalizeSiteDomainMappings(value)
  if (mappings.length === 0) throw new Error('至少需要一个有效域名')
  assertAppGroupsUsable(mappings)
  await setAdminSetting(env, SITE_DOMAIN_MAPPINGS_KEY, JSON.stringify(mappings))
  await redis.set(CACHE_KEY, JSON.stringify(mappings), 'EX', CACHE_TTL_SECONDS)
  return mappings
}

export function marketForHost(mappings: SiteDomainMapping[], host: string | undefined): SiteMarket | null {
  const domain = normalizeDomain(host ?? '')
  if (!domain) return null
  const target = mappings.find((item) => item.enabled && item.domain === domain)?.market
  return target === 'PH' || target === 'ID' ? target : null
}

export function appDomainsForMarket(mappings: SiteDomainMapping[], market: SiteMarket): SiteDomainMapping[] {
  return mappings
    .filter((item) => item.enabled && item.appMarket === market && item.market === market)
    .sort((a, b) => a.appPriority - b.appPriority || a.domain.localeCompare(b.domain))
}

/** /app/bootstrap 的最后一道兜底：配置异常也绝不给 App 下发空线路表 */
export function defaultAppDomainsForMarket(market: SiteMarket): SiteDomainMapping[] {
  return DEFAULT_APP_DOMAINS[market].map((item) => ({
    domain: item.domain,
    market,
    enabled: true,
    appMarket: market,
    appPriority: item.appPriority,
  }))
}
