import type { Redis } from 'ioredis'
import type { SiteDomainMapping, SiteMarket } from './site-domain.service.js'

export interface RouteProbe {
  domain: string
  ok: boolean
  elapsedMs: number
}

export interface RouteHealthRow {
  domain: string
  ok: number
  fail: number
  successRate: number
  avgMs: number | null
  selected: number
}

const WINDOW_HOURS = 24
const TTL_SECONDS = 7 * 24 * 3600

function bucketKey(market: SiteMarket, at: Date): string {
  const stamp = at.toISOString().slice(0, 13).replace(/[-T]/g, '')
  return `route:health:${market}:${stamp}`
}

/**
 * App 探活结果只按域名累加计数，不落库、不记用户 —— 端点是公开的，
 * 存明细等于给任何人一个免费写库通道。域名也必须先在映射表里，否则
 * 伪造的域名字符串会把 Redis 键空间撑爆。
 */
export async function recordRouteProbes(
  redis: Redis, market: SiteMarket, mappings: SiteDomainMapping[],
  probes: RouteProbe[], selected: string,
): Promise<number> {
  const known = new Set(mappings.map((item) => item.domain))
  const key = bucketKey(market, new Date())
  const pipeline = redis.pipeline()
  let accepted = 0
  for (const probe of probes) {
    if (!known.has(probe.domain)) continue
    accepted += 1
    pipeline.hincrby(key, `${probe.domain}:${probe.ok ? 'ok' : 'fail'}`, 1)
    if (probe.ok && probe.elapsedMs > 0) pipeline.hincrby(key, `${probe.domain}:ms`, Math.round(probe.elapsedMs))
  }
  if (accepted === 0) return 0
  if (known.has(selected)) pipeline.hincrby(key, `${selected}:selected`, 1)
  pipeline.expire(key, TTL_SECONDS)
  await pipeline.exec()
  return accepted
}

export async function getRouteHealth(redis: Redis, market: SiteMarket): Promise<RouteHealthRow[]> {
  const now = Date.now()
  const keys = Array.from({ length: WINDOW_HOURS }, (_, i) => bucketKey(market, new Date(now - i * 3600_000)))
  const buckets = await Promise.all(keys.map((key) => redis.hgetall(key)))

  const totals = new Map<string, { ok: number; fail: number; ms: number; selected: number }>()
  for (const bucket of buckets) {
    for (const [field, raw] of Object.entries(bucket)) {
      const at = field.lastIndexOf(':')
      const domain = field.slice(0, at)
      const metric = field.slice(at + 1)
      const row = totals.get(domain) ?? { ok: 0, fail: 0, ms: 0, selected: 0 }
      if (metric === 'ok' || metric === 'fail' || metric === 'ms' || metric === 'selected') {
        row[metric] += Number(raw) || 0
      }
      totals.set(domain, row)
    }
  }

  return [...totals.entries()]
    .map(([domain, row]) => ({
      domain,
      ok: row.ok,
      fail: row.fail,
      successRate: row.ok + row.fail === 0 ? 0 : Math.round((row.ok / (row.ok + row.fail)) * 100),
      avgMs: row.ok === 0 ? null : Math.round(row.ms / row.ok),
      selected: row.selected,
    }))
    .sort((a, b) => b.selected - a.selected || a.domain.localeCompare(b.domain))
}
