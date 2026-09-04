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
    keys: vi.fn(async (p: string) => [...store.keys()].filter((k) => k.startsWith(p.replace(/\*$/, '')))),
  } as unknown as Redis & { store: Map<string, string> }
}

let redis = fakeRedis()
vi.mock('../clients/redis.client.js', async () => {
  const actual = await vi.importActual<typeof import('../clients/redis.client.js')>('../clients/redis.client.js')
  return { ...actual, getDefaultRedis: () => redis }
})

const {
  getTenantI18nOverrides, invalidateTenantI18nCache, isSupportedLocale, MAX_OVERRIDES_PER_TENANT,
} = await import('../services/tenant-i18n.service.js')

const env = {} as Env

beforeEach(() => { query.mockReset(); redis = fakeRedis() })

describe('租户文案覆盖', () => {
  it('按语言分组返回扁平键', async () => {
    query.mockResolvedValueOnce([[
      { locale: 'en', key_path: 'checkin.title', value: 'Sign In' },
      { locale: 'en', key_path: 'nav.casino', value: 'Lobby' },
      { locale: 'id', key_path: 'checkin.title', value: 'Masuk' },
    ]])
    const out = await getTenantI18nOverrides(env, 9)
    expect(out).toEqual({
      en: { 'checkin.title': 'Sign In', 'nav.casino': 'Lobby' },
      id: { 'checkin.title': 'Masuk' },
    })
  })

  it('不支持的语言被丢弃，不透传给前端', async () => {
    query.mockResolvedValueOnce([[
      { locale: 'fr', key_path: 'a.b', value: 'x' },
      { locale: 'en', key_path: 'a.b', value: 'y' },
    ]])
    const out = await getTenantI18nOverrides(env, 9)
    expect(out.fr).toBeUndefined()
    expect(out.en['a.b']).toBe('y')
  })

  it('查询带条数上限，防止 bootstrap 被撑大', async () => {
    query.mockResolvedValueOnce([[]])
    await getTenantI18nOverrides(env, 9)
    expect(query.mock.calls[0][1]).toEqual([9, MAX_OVERRIDES_PER_TENANT])
  })

  it('缓存键无租户前缀，失效后回源', async () => {
    query.mockResolvedValueOnce([[{ locale: 'en', key_path: 'a.b', value: '1' }]])
    await getTenantI18nOverrides(env, 9)
    expect([...redis.store.keys()]).toEqual(['platform:tenant-i18n:9'])
    await getTenantI18nOverrides(env, 9)
    expect(query).toHaveBeenCalledTimes(1)

    await invalidateTenantI18nCache(env, 9)
    query.mockResolvedValueOnce([[{ locale: 'en', key_path: 'a.b', value: '2' }]])
    expect((await getTenantI18nOverrides(env, 9)).en['a.b']).toBe('2')
  })

  it('平台库故障时按无覆盖处理且不写缓存', async () => {
    query.mockRejectedValueOnce(new Error('boom'))
    expect(await getTenantI18nOverrides(env, 9)).toEqual({})
    expect(redis.store.size).toBe(0)
  })

  it('isSupportedLocale 只认四种语言', () => {
    expect(isSupportedLocale('zh-CN')).toBe(true)
    expect(isSupportedLocale('fr')).toBe(false)
    expect(isSupportedLocale(null)).toBe(false)
  })
})
