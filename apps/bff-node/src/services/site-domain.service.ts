import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getAdminSetting, setAdminSetting } from './admin-store.js'

export type SiteMarket = 'PH' | 'ID'
export type SiteDomainTarget = SiteMarket | 'PUBLIC'
export interface SiteDomainMapping {
  domain: string
  market: SiteDomainTarget
  enabled: boolean
}

export const SITE_DOMAIN_MAPPINGS_KEY = 'site_domain_mappings'
const CACHE_KEY = 'config:site-domain-mappings'
const CACHE_TTL_SECONDS = 300

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
    result.push({ domain, market, enabled: row.enabled !== false })
  }
  return result
}

function envMappings(env: Env): SiteDomainMapping[] {
  try {
    const parsed = JSON.parse(env.MARKET_DOMAIN_MAP) as Record<string, string>
    return normalizeSiteDomainMappings(Object.entries(parsed).map(([domain, market]) => ({ domain, market, enabled: true })))
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
  if (mappings.length === 0) mappings = envMappings(env)
  await redis.set(CACHE_KEY, JSON.stringify(mappings), 'EX', CACHE_TTL_SECONDS)
  return mappings
}

export async function saveSiteDomainMappings(redis: Redis, env: Env, value: unknown): Promise<SiteDomainMapping[]> {
  const mappings = normalizeSiteDomainMappings(value)
  if (mappings.length === 0) throw new Error('至少需要一个有效域名')
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
