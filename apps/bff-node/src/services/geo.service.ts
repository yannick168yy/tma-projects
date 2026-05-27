import geoip from 'geoip-lite'

const PRIVATE_RANGES = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1|fc|fd)/

export function lookupRegion(ip: string): string {
  if (!ip || PRIVATE_RANGES.test(ip)) return 'Local'
  try {
    const geo = geoip.lookup(ip)
    if (!geo) return 'Unknown'
    const parts = [geo.country, geo.city || geo.region].filter(Boolean)
    return parts.join(' · ') || 'Unknown'
  } catch {
    return 'Unknown'
  }
}
