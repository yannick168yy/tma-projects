import { setSiteFeatures } from './features'
import { applySiteIdentity, applySiteTheme, setSiteBrand } from './brand'

export type SiteMarket = 'PH' | 'ID'

// 兜底表，不是真相源（P1-12）：真相是服务端 bootstrap 下发的 market，
// 其次是它上次对该域名的判定（下面的 domain-market 缓存）。
// 这张编译期快照只在两者都拿不到时才用得上，且只覆盖自营站自己的域名 ——
// 包网客户的域名永远不会出现在这里，他们必须靠服务端下发。
const DEFAULT_DOMAIN_MARKETS: Record<string, SiteMarket> = {
  'betogo666.com': 'PH',
  'betogo777.com': 'PH',
  'betogo.ph': 'PH',
  'betogo.xyz': 'ID',
  'betogo.vip': 'ID',
  'betogo888.com': 'ID',
  'betogo.cc': 'ID',
  'betogo.games': 'PH',
  'www.betogo.games': 'PH',
  'betogo.app': 'ID',
}

const MARKET_STORAGE_KEY = 'betogo_market'
// 按域名记住服务端最近一次的判定。内置表是编译期快照，后台改了某域名的所属站点
// 它不会跟着变；服务端拿不到时，用「上次服务端说的」远比用「出包那天写死的」准。
const DOMAIN_MARKET_CACHE_KEY = 'betogo_domain_market'
let runtimeMarket: SiteMarket | null = null

function cacheDomainMarket(host: string, market: SiteMarket): void {
  try {
    const raw = localStorage.getItem(DOMAIN_MARKET_CACHE_KEY)
    const map = raw ? JSON.parse(raw) as Record<string, string> : {}
    map[host] = market
    localStorage.setItem(DOMAIN_MARKET_CACHE_KEY, JSON.stringify(map))
  } catch { /* 缓存失败不影响主流程 */ }
}

function readCachedDomainMarket(host: string): SiteMarket | null {
  try {
    const raw = localStorage.getItem(DOMAIN_MARKET_CACHE_KEY)
    if (!raw) return null
    const value = (JSON.parse(raw) as Record<string, string>)[host]
    return value === 'PH' || value === 'ID' ? value : null
  } catch {
    return null
  }
}

export async function initSiteMarketConfig(): Promise<void> {
  if (typeof window === 'undefined') return
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`${window.location.origin}/api/v1/site/config`, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return
    const body = await res.json() as {
      code?: number
      data?: { market?: string; features?: unknown; brand?: unknown; theme?: unknown }
    }
    if (body.code !== 0) return
    // /site/config 是租户 bootstrap（P1-9）：市场 + 功能开关 + 品牌 + 主题一次下发
    setSiteFeatures(body.data?.features)
    setSiteBrand(body.data?.brand)
    applySiteTheme(body.data?.theme)
    applySiteIdentity()
    const market = body.data?.market?.toUpperCase()
    if (market === 'PH' || market === 'ID') {
      runtimeMarket = market
      cacheDomainMarket(window.location.hostname.toLowerCase(), market)
    }
  } catch {
    // 启动配置不可用时继续使用内置映射，避免阻断站点。
  } finally {
    window.clearTimeout(timer)
  }
}

function configuredDomainMarkets(): Record<string, SiteMarket> {
  const raw = import.meta.env.VITE_MARKET_DOMAIN_MAP?.trim()
  if (!raw) return DEFAULT_DOMAIN_MARKETS
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    return Object.fromEntries(Object.entries(parsed)
      .map(([host, market]) => [host.toLowerCase(), market.toUpperCase()])
      .filter((entry): entry is [string, SiteMarket] => entry[1] === 'PH' || entry[1] === 'ID'))
  } catch {
    return DEFAULT_DOMAIN_MARKETS
  }
}

function explicitMarket(): SiteMarket | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('market')?.toUpperCase()
  return raw === 'PH' || raw === 'ID' ? raw : null
}

export function getSiteMarket(): SiteMarket {
  if (typeof window === 'undefined') return 'PH'
  const explicit = explicitMarket()
  if (explicit) {
    localStorage.setItem(MARKET_STORAGE_KEY, explicit)
    return explicit
  }
  if (runtimeMarket) {
    localStorage.setItem(MARKET_STORAGE_KEY, runtimeMarket)
    return runtimeMarket
  }
  const hostname = window.location.hostname.toLowerCase()
  // 服务端此刻不可达时，优先信任它上次对这个域名的判定，再退回编译期内置表
  const cached = readCachedDomainMarket(hostname)
  if (cached) {
    localStorage.setItem(MARKET_STORAGE_KEY, cached)
    return cached
  }
  const domainMarkets = configuredDomainMarkets()
  const byDomain = domainMarkets[hostname] ?? domainMarkets[hostname.replace(/^www\./, '')]
  if (byDomain) {
    localStorage.setItem(MARKET_STORAGE_KEY, byDomain)
    return byDomain
  }
  const stored = localStorage.getItem(MARKET_STORAGE_KEY)?.toUpperCase()
  if (stored === 'PH' || stored === 'ID') return stored
  const configured = import.meta.env.VITE_DEFAULT_MARKET?.toUpperCase()
  return configured === 'ID' ? 'ID' : 'PH'
}

export function defaultMarketLocale(): 'en' | 'id' {
  return getSiteMarket() === 'ID' ? 'id' : 'en'
}

export function defaultMarketCurrency(): 'PHP' | 'IDR' {
  return getSiteMarket() === 'ID' ? 'IDR' : 'PHP'
}
