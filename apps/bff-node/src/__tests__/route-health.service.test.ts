import { describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import { normalizeSiteDomainMappings } from '../services/site-domain.service.js'
import { recordRouteProbes } from '../services/route-health.service.js'

const mappings = normalizeSiteDomainMappings([
  { domain: 'betogo.games', market: 'PH', enabled: true, appMarket: 'PH', appPriority: 10 },
  { domain: 'betogo666.com', market: 'PH', enabled: true, appMarket: 'PH', appPriority: 20 },
])

function redisStub() {
  const calls: Array<[string, ...unknown[]]> = []
  const pipeline = {
    hincrby: (...args: unknown[]) => { calls.push(['hincrby', ...args]); return pipeline },
    expire: (...args: unknown[]) => { calls.push(['expire', ...args]); return pipeline },
    exec: vi.fn(async () => []),
  }
  return { redis: { pipeline: () => pipeline } as unknown as Redis, calls }
}

describe('线路健康度上报', () => {
  it('只接受映射表里的域名，伪造域名不会写进 Redis', async () => {
    const { redis, calls } = redisStub()
    const accepted = await recordRouteProbes(redis, 'PH', mappings, [
      { domain: 'betogo.games', ok: true, elapsedMs: 120 },
      { domain: 'evil.example', ok: true, elapsedMs: 50 },
    ], 'betogo.games')

    expect(accepted).toBe(1)
    expect(calls.some((c) => String(c[1]).startsWith('evil.example'))).toBe(false)
  })

  it('记录成功/失败与选中次数，并设置过期', async () => {
    const { redis, calls } = redisStub()
    await recordRouteProbes(redis, 'PH', mappings, [
      { domain: 'betogo.games', ok: true, elapsedMs: 120 },
      { domain: 'betogo666.com', ok: false, elapsedMs: 0 },
    ], 'betogo.games')

    const fields = calls.filter((c) => c[0] === 'hincrby').map((c) => String(c[2]))
    expect(fields).toContain('betogo.games:ok')
    expect(fields).toContain('betogo.games:ms')
    expect(fields).toContain('betogo666.com:fail')
    expect(fields).toContain('betogo.games:selected')
    expect(calls.some((c) => c[0] === 'expire')).toBe(true)
  })

  it('全部域名都不在映射表时不写任何键', async () => {
    const { redis, calls } = redisStub()
    const accepted = await recordRouteProbes(redis, 'PH', mappings, [
      { domain: 'evil.example', ok: true, elapsedMs: 10 },
    ], 'evil.example')
    expect(accepted).toBe(0)
    expect(calls).toHaveLength(0)
  })
})
