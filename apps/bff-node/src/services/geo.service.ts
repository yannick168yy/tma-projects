import geoip from 'geoip-lite'

const PRIVATE_RANGES = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1$|fc|fd)/

let countryNames: Intl.DisplayNames | undefined
try {
  countryNames = new Intl.DisplayNames(['en'], { type: 'region' })
} catch {
  // fallback to country code if Intl not available
}

function countryName(code: string): string {
  try {
    return countryNames?.of(code) ?? code
  } catch {
    return code
  }
}

export function lookupRegion(ip: string): string | undefined {
  if (!ip) return undefined
  const clean = ip.replace(/^::ffff:/i, '')
  if (PRIVATE_RANGES.test(clean)) return undefined
  try {
    const geo = geoip.lookup(clean)
    if (!geo) return undefined
    const country = countryName(geo.country)
    const parts = [country, geo.region, geo.city].filter(Boolean)
    return parts.join(' · ') || undefined
  } catch {
    return undefined
  }
}
