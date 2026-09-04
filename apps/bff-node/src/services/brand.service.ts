import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { getDefaultRedis, scanKeys } from '../clients/redis.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('brand')

// 与 tenant-feature.service 同样的理由：平台级数据、由平台控制台失效，
// 必须走无前缀客户端，否则控制台删不掉租户前缀下的键，改了品牌不生效。
const CACHE_PREFIX = 'platform:tenant-brand:'
const CACHE_TTL_SECONDS = 300

/**
 * 可被租户覆盖的主题变量白名单。
 *
 * 刻意不做成「任意 CSS 变量」：那等于把后台配置变成一个注入面，
 * 且租户能改掉布局类变量后整站错版，出了问题分不清是平台的锅还是他自己改的。
 * 只放品牌真正需要的那几个。
 */
export const THEME_KEYS = [
  'primary', 'primaryForeground', 'accent', 'accentForeground', 'radius', 'fontSans', 'fontDisplay',
] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

/** 主题变量 → theme.css 里的 CSS 变量名 */
export const THEME_CSS_VAR: Record<ThemeKey, string> = {
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  radius: '--radius',
  fontSans: '--font-sans',
  fontDisplay: '--font-display',
}

const COLOR_KEYS = new Set<ThemeKey>(['primary', 'primaryForeground', 'accent', 'accentForeground'])
const HEX = /^#[0-9a-fA-F]{6}$/
const LENGTH = /^\d+(\.\d+)?(rem|px)$/
// 字体名只允许字母数字空格连字符与逗号：够表达 "Nunito, sans-serif"，
// 又挡住引号和分号这类能从 style 值里逃出去的字符
const FONT = /^[A-Za-z0-9 ,-]{1,64}$/

/** 校验单个主题值。不合法返回原因，供后台直接显示 */
export function validateThemeValue(key: ThemeKey, value: string): string | null {
  if (COLOR_KEYS.has(key)) return HEX.test(value) ? null : '需为 #RRGGBB 形式的颜色'
  if (key === 'radius') return LENGTH.test(value) ? null : '需为 rem 或 px 长度，如 0.75rem'
  return FONT.test(value) ? null : '字体名只能含字母、数字、空格、逗号与连字符'
}

export interface TenantBrand {
  siteName: string
  shortName: string
  logoTextPrimary: string
  logoTextAccent: string
  tagline: string
  logoLightUrl: string | null
  logoDarkUrl: string | null
  faviconUrl: string | null
  appIconUrl: string | null
  theme: Partial<Record<ThemeKey, string>>
}

/**
 * 无品牌配置时的兜底 = 自营站现有品牌。
 *
 * 这样"平台库读不到"与"品牌没配"都退化成今天线上的样子，而不是一个空白站 ——
 * 空站名会让标题栏、版权行、安装引导全变成空字符串，比多显示一个默认名难看得多。
 */
export const DEFAULT_BRAND: TenantBrand = {
  siteName: 'BETOGO',
  shortName: 'B',
  logoTextPrimary: 'BETO',
  logoTextAccent: 'GO',
  tagline: 'Bet. Go. Win',
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  appIconUrl: null,
  theme: {},
}

interface BrandRow extends RowDataPacket {
  site_name: string
  short_name: string
  logo_text_primary: string
  logo_text_accent: string
  tagline: string
  logo_light_key: string | null
  logo_dark_key: string | null
  favicon_key: string | null
  app_icon_key: string | null
  theme: unknown
}

/**
 * storage key → 可访问 URL。
 * 与首页图片同一个出口（`/api/v1/home/images/*`）：那条路由按 Host 认租户、
 * 再按租户前缀读文件，租户各自的资产天然隔离，不需要另起一套服务路径。
 */
function assetUrl(env: Env, key: string | null): string | null {
  if (!key) return null
  const path = key.split('/').map(encodeURIComponent).join('/')
  const s3Base = env.S3_PUBLIC_BASE_URL.trim().replace(/\/$/, '')
  if (s3Base) return `${s3Base}/${path}`
  const cdnBase = env.IMAGE_CDN_BASE.trim().replace(/\/$/, '')
  return cdnBase ? `${cdnBase}/api/v1/home/images/${path}` : `/api/v1/home/images/${path}`
}

function parseTheme(raw: unknown): Partial<Record<ThemeKey, string>> {
  const obj = typeof raw === 'string' ? safeJson(raw) : raw
  if (!obj || typeof obj !== 'object') return {}
  const out: Partial<Record<ThemeKey, string>> = {}
  for (const key of THEME_KEYS) {
    const value = (obj as Record<string, unknown>)[key]
    // 存进去时已校验过，这里再挡一次：库里可能有手工改过的脏值
    if (typeof value === 'string' && value && !validateThemeValue(key, value)) out[key] = value
  }
  return out
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

function toBrand(env: Env, row: BrandRow): TenantBrand {
  return {
    siteName: row.site_name || DEFAULT_BRAND.siteName,
    shortName: row.short_name || DEFAULT_BRAND.shortName,
    logoTextPrimary: row.logo_text_primary,
    logoTextAccent: row.logo_text_accent,
    tagline: row.tagline,
    logoLightUrl: assetUrl(env, row.logo_light_key),
    logoDarkUrl: assetUrl(env, row.logo_dark_key),
    faviconUrl: assetUrl(env, row.favicon_key),
    appIconUrl: assetUrl(env, row.app_icon_key),
    theme: parseTheme(row.theme),
  }
}

async function queryBrand(env: Env, tenantId: number): Promise<TenantBrand> {
  const [rows] = await getPlatformPool().query<BrandRow[]>(
    `SELECT site_name, short_name, logo_text_primary, logo_text_accent, tagline,
            logo_light_key, logo_dark_key, favicon_key, app_icon_key, theme
       FROM pf_tenant_brand WHERE tenant_id = ? LIMIT 1`,
    [tenantId],
  )
  return rows[0] ? toBrand(env, rows[0]) : DEFAULT_BRAND
}

export async function getTenantBrand(env: Env, tenantId: number): Promise<TenantBrand> {
  const redis = getDefaultRedis(env)
  const cacheKey = `${CACHE_PREFIX}${tenantId}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try { return JSON.parse(cached) as TenantBrand } catch { /* 缓存脏了就回源 */ }
  }

  let brand: TenantBrand
  try {
    brand = await queryBrand(env, tenantId)
  } catch (err) {
    log.error({ err, tenantId }, '读取租户品牌失败，本次用默认品牌')
    return DEFAULT_BRAND
  }

  await redis.set(cacheKey, JSON.stringify(brand), 'EX', CACHE_TTL_SECONDS)
  return brand
}

export async function invalidateTenantBrandCache(env: Env, tenantId?: number): Promise<void> {
  const redis = getDefaultRedis(env)
  if (tenantId !== undefined) {
    await redis.del(`${CACHE_PREFIX}${tenantId}`)
    return
  }
  const keys = await scanKeys(redis, `${CACHE_PREFIX}*`)
  if (keys.length > 0) await redis.del(...keys)
}

export interface BrandUpdate {
  siteName?: string
  shortName?: string
  logoTextPrimary?: string
  logoTextAccent?: string
  tagline?: string
  logoLightKey?: string | null
  logoDarkKey?: string | null
  faviconKey?: string | null
  appIconKey?: string | null
  theme?: Partial<Record<ThemeKey, string>>
}

/** 平台后台读原始配置（key 而非 URL）—— 后台要能看出资产有没有配、配的是哪一个 */
export async function getTenantBrandRaw(tenantId: number): Promise<(BrandUpdate & { updatedAt: string | null }) | null> {
  const [rows] = await getPlatformPool().query<BrandRow[]>(
    `SELECT site_name, short_name, logo_text_primary, logo_text_accent, tagline,
            logo_light_key, logo_dark_key, favicon_key, app_icon_key, theme, updated_at
       FROM pf_tenant_brand WHERE tenant_id = ? LIMIT 1`,
    [tenantId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    siteName: row.site_name,
    shortName: row.short_name,
    logoTextPrimary: row.logo_text_primary,
    logoTextAccent: row.logo_text_accent,
    tagline: row.tagline,
    logoLightKey: row.logo_light_key,
    logoDarkKey: row.logo_dark_key,
    faviconKey: row.favicon_key,
    appIconKey: row.app_icon_key,
    theme: parseTheme(row.theme),
    updatedAt: (row as unknown as { updated_at: Date | null }).updated_at?.toISOString() ?? null,
  }
}

const COLUMN: Record<keyof BrandUpdate, string> = {
  siteName: 'site_name',
  shortName: 'short_name',
  logoTextPrimary: 'logo_text_primary',
  logoTextAccent: 'logo_text_accent',
  tagline: 'tagline',
  logoLightKey: 'logo_light_key',
  logoDarkKey: 'logo_dark_key',
  faviconKey: 'favicon_key',
  appIconKey: 'app_icon_key',
  theme: 'theme',
}

/** 只更新传了的字段。整行覆盖会把「这次只改主色」变成把其他字段清空 */
export async function saveTenantBrand(tenantId: number, patch: BrandUpdate): Promise<void> {
  const cols: string[] = []
  const vals: unknown[] = []
  for (const [field, column] of Object.entries(COLUMN) as Array<[keyof BrandUpdate, string]>) {
    if (!(field in patch)) continue
    const raw = patch[field]
    cols.push(column)
    vals.push(field === 'theme' ? JSON.stringify(raw ?? {}) : raw)
  }
  if (cols.length === 0) return

  await getPlatformPool().query<ResultSetHeader>(
    `INSERT INTO pf_tenant_brand (tenant_id, ${cols.join(', ')}) VALUES (?${', ?'.repeat(cols.length)})
     ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
    [tenantId, ...vals],
  )
}

export interface TenantMarketInfo {
  market: string
  currency: string
  timezone: string
}

/**
 * 租户开通的市场。bootstrap 用它下发币种与语言，
 * 让前端不必再靠编译期的域名→市场表推断（P1-12）。
 */
export async function getTenantMarkets(tenantId: number): Promise<TenantMarketInfo[]> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT market, currency, timezone FROM pf_tenant_market WHERE tenant_id = ? AND enabled = 1 ORDER BY market',
    [tenantId],
  )
  return rows.map((r) => ({
    market: String(r.market),
    currency: String(r.currency),
    timezone: String(r.timezone),
  }))
}
