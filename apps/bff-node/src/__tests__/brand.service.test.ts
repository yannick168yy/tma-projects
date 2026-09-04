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
  DEFAULT_BRAND, getTenantBrand, invalidateTenantBrandCache, saveTenantBrand, validateThemeValue,
} = await import('../services/brand.service.js')

const env = { S3_PUBLIC_BASE_URL: '', IMAGE_CDN_BASE: '' } as Env

const row = {
  site_name: 'LuckyOne', short_name: 'L',
  logo_text_primary: 'LUCKY', logo_text_accent: 'ONE', tagline: 'Play. Win.',
  logo_light_key: null, logo_dark_key: 'brand/logoDark/a.png',
  favicon_key: null, app_icon_key: null,
  theme: { primary: '#112233' },
}

beforeEach(() => { query.mockReset(); redis = fakeRedis() })

describe('租户品牌', () => {
  it('无配置时回落默认品牌，不产生空站名', async () => {
    query.mockResolvedValueOnce([[]])
    const brand = await getTenantBrand(env, 5)
    expect(brand).toEqual(DEFAULT_BRAND)
    expect(brand.siteName).toBeTruthy()
  })

  it('读出配置并把 storage key 转成可访问 URL', async () => {
    query.mockResolvedValueOnce([[row]])
    const brand = await getTenantBrand(env, 5)
    expect(brand.siteName).toBe('LuckyOne')
    expect(brand.logoDarkUrl).toBe('/api/v1/home/images/brand/logoDark/a.png')
    expect(brand.logoLightUrl).toBeNull()
    expect(brand.theme.primary).toBe('#112233')
  })

  it('站名为空串时回落默认值，避免标题栏变空', async () => {
    query.mockResolvedValueOnce([[{ ...row, site_name: '' }]])
    expect((await getTenantBrand(env, 5)).siteName).toBe(DEFAULT_BRAND.siteName)
  })

  it('库里的脏主题值被丢弃，不透传到前端', async () => {
    query.mockResolvedValueOnce([[{ ...row, theme: { primary: 'red; } body{display:none}', accent: '#00ff00' } }]])
    const { theme } = await getTenantBrand(env, 5)
    expect(theme.primary).toBeUndefined()
    expect(theme.accent).toBe('#00ff00')
  })

  it('缓存键无租户前缀，且失效后回源', async () => {
    query.mockResolvedValueOnce([[row]])
    await getTenantBrand(env, 5)
    expect([...redis.store.keys()]).toEqual(['platform:tenant-brand:5'])

    await getTenantBrand(env, 5)
    expect(query).toHaveBeenCalledTimes(1)

    await invalidateTenantBrandCache(env, 5)
    query.mockResolvedValueOnce([[{ ...row, site_name: 'Renamed' }]])
    expect((await getTenantBrand(env, 5)).siteName).toBe('Renamed')
  })

  it('平台库故障时用默认品牌且不写缓存', async () => {
    query.mockRejectedValueOnce(new Error('boom'))
    expect(await getTenantBrand(env, 5)).toEqual(DEFAULT_BRAND)
    expect(redis.store.size).toBe(0)
  })

  it('只更新传了的字段，不把其他字段清空', async () => {
    query.mockResolvedValueOnce([{}])
    await saveTenantBrand(5, { siteName: 'OnlyName' })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('site_name')
    expect(sql).not.toContain('tagline')
    expect(params).toEqual([5, 'OnlyName'])
  })

  it('主题值校验：颜色要 hex，长度要 rem/px，字体挡掉引号分号', () => {
    expect(validateThemeValue('primary', '#ffb800')).toBeNull()
    expect(validateThemeValue('primary', 'red')).toBeTruthy()
    expect(validateThemeValue('radius', '0.75rem')).toBeNull()
    expect(validateThemeValue('radius', '0.75')).toBeTruthy()
    expect(validateThemeValue('fontSans', 'Nunito, sans-serif')).toBeNull()
    expect(validateThemeValue('fontSans', "x'; }")).toBeTruthy()
  })
})
