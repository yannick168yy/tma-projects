import geoip from 'geoip-lite'

const PRIVATE_RANGES = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1$|fc|fd)/

export function lookupRegion(ip: string): string | undefined {
  if (!ip) return undefined
  // 剥离 IPv4-mapped IPv6 前缀（::ffff:1.2.3.4 → 1.2.3.4）
  const clean = ip.replace(/^::ffff:/i, '')
  if (PRIVATE_RANGES.test(clean)) return undefined
  try {
    const geo = geoip.lookup(clean)
    if (!geo) return undefined
    const parts = [geo.country, geo.city || geo.region].filter(Boolean)
    return parts.join(' · ') || undefined
  } catch {
    return undefined
  }
}
