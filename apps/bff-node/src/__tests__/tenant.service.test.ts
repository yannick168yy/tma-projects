import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'

const query = vi.fn()
vi.mock('../clients/platform-mysql.client.js', () => ({
  getPlatformPool: () => ({ query }),
  platformDatabase: () => 'betogo_platform',
}))

const { normalizeHost, resolveTenantByHost, invalidateTenantHostCache } =
  await import('../services/tenant.service.js')

function fakeRedis() {
  const store = new Map<string, string>()
  return {
    // 真实客户端一定有 options，桩要保持同构，否则 scanKeys 这类读 options 的代码测不到
    options: { keyPrefix: undefined },
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK' }),
    del: vi.fn(async (...ks: string[]) => { ks.forEach((k) => store.delete(k)); return ks.length }),
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, '')
      return [...store.keys()].filter((k) => k.startsWith(prefix))
    }),
  } as unknown as Redis & { store: Map<string, string> }
}

const row = { id: 1, code: 'betogo', db_name: 'betogo', status: 'active', self_operated: 1, pool_min: 2, pool_max: 10, queue_limit: 0 }

beforeEach(() => { query.mockReset() })

describe('租户解析', () => {
  it('归一化 Host：去协议端口路径与 www', () => {
    expect(normalizeHost('https://WWW.BetoGo.Games:8443/api/v1/x')).toBe('betogo.games')
    expect(normalizeHost('betogo.ph.')).toBe('betogo.ph')
    expect(normalizeHost(undefined)).toBe('')
  })

  it('命中后写缓存，第二次不再打平台库', async () => {
    const redis = fakeRedis()
    query.mockResolvedValue([[row]])
    const first = await resolveTenantByHost(redis, 'www.betogo.games')
    expect(first).toEqual({
      id: 1, code: 'betogo', database: 'betogo', status: 'active', selfOperated: true,
      pool: { min: 2, max: 10, queueLimit: 0 },
    })

    const second = await resolveTenantByHost(redis, 'betogo.games')
    expect(second).toEqual(first)
    expect(query).toHaveBeenCalledTimes(1)
  })

  // 乱填 Host 的扫描器不能每次都把平台库打一遍
  it('未命中也进缓存，不重复回源', async () => {
    const redis = fakeRedis()
    query.mockResolvedValue([[]])
    expect(await resolveTenantByHost(redis, 'evil.example')).toBeNull()
    expect(await resolveTenantByHost(redis, 'evil.example')).toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
  })

  // 平台库故障时若把 null 缓存下来，恢复后 5 分钟内所有请求还是错的
  it('平台库报错时不写缓存', async () => {
    const redis = fakeRedis()
    query.mockRejectedValue(new Error('db down'))
    expect(await resolveTenantByHost(redis, 'betogo.ph')).toBeNull()
    expect(redis.store.size).toBe(0)

    query.mockResolvedValue([[row]])
    expect(await resolveTenantByHost(redis, 'betogo.ph')).not.toBeNull()
  })

  it('失效指定域名与全量失效', async () => {
    const redis = fakeRedis()
    query.mockResolvedValue([[row]])
    await resolveTenantByHost(redis, 'betogo.games')
    await resolveTenantByHost(redis, 'betogo.ph')
    expect(redis.store.size).toBe(2)

    await invalidateTenantHostCache(redis, 'www.betogo.games')
    expect(redis.store.size).toBe(1)
    await invalidateTenantHostCache(redis)
    expect(redis.store.size).toBe(0)
  })
})
