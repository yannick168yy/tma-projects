export type SiteMarket = 'PH' | 'ID'

const DEFAULT_DOMAIN_MARKETS: Record<string, SiteMarket> = {
  'betogo666.com': 'PH',
  'betogo777.com': 'PH',
  'betogo.ph': 'PH',
  'betogo.xyz': 'ID',
  'betogo.vip': 'ID',
  'betogo888.com': 'ID',
  'betogo.cc': 'ID',
}

const MARKET_STORAGE_KEY = 'betogo_market'

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
  const byDomain = configuredDomainMarkets()[window.location.hostname.toLowerCase()]
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
