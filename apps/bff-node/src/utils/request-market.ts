import type { Context } from 'koa'
import { getSiteDomainMappings, marketForHost, type SiteMarket } from '../services/site-domain.service.js'

function requestHost(ctx: Context): string {
  for (const raw of [ctx.get('x-viewer-host'), ctx.get('origin'), ctx.get('referer'), ctx.get('host')]) {
    if (!raw) continue
    try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname } catch { /* 继续 */ }
  }
  return ''
}

export function marketForCurrency(currency: string | undefined): SiteMarket | null {
  const value = currency?.trim().toUpperCase()
  if (value === 'INR') return 'IN'
  if (value === 'IDR') return 'ID'
  if (value === 'PHP') return 'PH'
  return null
}

/** INR 始终走印度规则；否则优先按站点域名，再按客户端市场与币种兜底。 */
export async function resolveRequestMarket(ctx: Context, currency?: string): Promise<SiteMarket> {
  if (currency?.trim().toUpperCase() === 'INR') return 'IN'

  const host = requestHost(ctx)
  if (host) {
    const market = marketForHost(await getSiteDomainMappings(ctx.state.redis, ctx.state.env), host)
    if (market) return market
  }

  const header = ctx.get('x-site-market').trim().toUpperCase()
  if (header === 'PH' || header === 'ID' || header === 'IN') return header
  return marketForCurrency(currency) ?? 'PH'
}
