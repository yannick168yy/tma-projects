import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'

const query = vi.fn()
vi.mock('../clients/platform-mysql.client.js', () => ({
  getPlatformPool: () => ({ query }),
  platformDatabase: () => 'betogo_platform',
}))

function fakeRedis() {
  const store = new Map<string, string>()
  return {
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

let redis = fakeRedis()
vi.mock('../clients/redis.client.js', async () => {
  const actual = await vi.importActual<typeof import('../clients/redis.client.js')>('../clients/redis.client.js')
  return { ...actual, getDefaultRedis: () => redis }
})

const {
  FEATURE_KEYS, getTenantFeatures, invalidateTenantFeatureCache, isFeatureKey, getPlanDefaults,
} = await import('../services/tenant-feature.service.js')

const env = {} as Env

/** 第一次 query 是套餐默认，第二次是租户覆盖 */
function mockRows(planRows: Array<{ feature_key: string; enabled: number }>, overrideRows: Array<{ feature_key: string; enabled: number }>) {
  query.mockResolvedValueOnce([planRows]).mockResolvedValueOnce([overrideRows])
}

beforeEach(() => {
  query.mockReset()
  redis = fakeRedis()
})

describe('租户功能开关', () => {
  it('无任何配置时全开', async () => {
    mockRows([], [])
    const features = await getTenantFeatures(env, 1)
    expect(Object.keys(features).sort()).toEqual([...FEATURE_KEYS].sort())
    expect(Object.values(features).every((v) => v === true)).toBe(true)
  })

  it('套餐关掉的功能生效', async () => {
    mockRows([{ feature_key: 'sports', enabled: 0 }], [])
    const features = await getTenantFeatures(env, 1)
    expect(features.sports).toBe(false)
    expect(features.slots).toBe(true)
  })

  it('租户覆盖优先于套餐默认值（两个方向都要）', async () => {
    mockRows(
      [{ feature_key: 'sports', enabled: 0 }, { feature_key: 'vip', enabled: 1 }],
      [{ feature_key: 'sports', enabled: 1 }, { feature_key: 'vip', enabled: 0 }],
    )
    const features = await getTenantFeatures(env, 1)
    expect(features.sports).toBe(true)
    expect(features.vip).toBe(false)
  })

  it('未知 feature_key 不进结果，避免脏数据污染开关集合', async () => {
    mockRows([{ feature_key: 'not_a_real_feature', enabled: 0 }], [])
    const features = await getTenantFeatures(env, 1)
    expect(features.not_a_real_feature).toBeUndefined()
    expect(Object.keys(features).sort()).toEqual([...FEATURE_KEYS].sort())
  })

  it('命中缓存后不再查库', async () => {
    mockRows([{ feature_key: 'spin', enabled: 0 }], [])
    await getTenantFeatures(env, 7)
    expect(query).toHaveBeenCalledTimes(2)
    const again = await getTenantFeatures(env, 7)
    expect(again.spin).toBe(false)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('失效后回源，且缓存键不带租户前缀（平台控制台要能删掉它）', async () => {
    mockRows([{ feature_key: 'spin', enabled: 0 }], [])
    await getTenantFeatures(env, 7)
    expect([...redis.store.keys()]).toEqual(['platform:tenant-features:7'])

    await invalidateTenantFeatureCache(env, 7)
    expect(redis.store.size).toBe(0)

    mockRows([{ feature_key: 'spin', enabled: 1 }], [])
    expect((await getTenantFeatures(env, 7)).spin).toBe(true)
  })

  it('平台库故障时按全开处理且不写缓存，避免把故障态钉进缓存', async () => {
    query.mockRejectedValueOnce(new Error('ENOTFOUND tma-mysql'))
    const features = await getTenantFeatures(env, 3)
    expect(Object.values(features).every((v) => v === true)).toBe(true)
    expect(redis.store.size).toBe(0)
  })

  it('getPlanDefaults 只反映套餐，不含租户覆盖', async () => {
    query.mockResolvedValueOnce([[{ feature_key: 'kyc', enabled: 0 }]])
    const defaults = await getPlanDefaults(1)
    expect(defaults.kyc).toBe(false)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('isFeatureKey 拒绝未知键', () => {
    expect(isFeatureKey('vip')).toBe(true)
    expect(isFeatureKey('vip; DROP TABLE')).toBe(false)
    expect(isFeatureKey(123)).toBe(false)
  })
})
