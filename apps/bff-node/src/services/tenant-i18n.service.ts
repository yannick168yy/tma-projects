import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { getDefaultRedis, scanKeys } from '../clients/redis.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('tenant-i18n')

// 同 tenant-feature / brand：平台级数据，必须走无前缀客户端，否则平台控制台失效不了
const CACHE_PREFIX = 'platform:tenant-i18n:'
const CACHE_TTL_SECONDS = 300

export const SUPPORTED_LOCALES = ['en', 'id', 'vi', 'zh-CN'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * bootstrap 每次页面加载都会拉，覆盖条数必须有上限。
 * 上限按「所有语言合计」算：客户端要能在运行时切语言而不重新拉 bootstrap，
 * 所以四种语言的覆盖是一起下发的。
 */
export const MAX_OVERRIDES_PER_TENANT = 800

/** { locale: { keyPath: value } } */
export type I18nOverrides = Record<string, Record<string, string>>

interface Row extends RowDataPacket {
  locale: string
  key_path: string
  value: string
}

async function queryOverrides(tenantId: number): Promise<I18nOverrides> {
  const [rows] = await getPlatformPool().query<Row[]>(
    'SELECT locale, key_path, value FROM pf_tenant_i18n WHERE tenant_id = ? ORDER BY locale, key_path LIMIT ?',
    [tenantId, MAX_OVERRIDES_PER_TENANT],
  )
  const out: I18nOverrides = {}
  for (const row of rows) {
    if (!isSupportedLocale(row.locale)) continue
    ;(out[row.locale] ??= {})[row.key_path] = row.value
  }
  return out
}

export async function getTenantI18nOverrides(env: Env, tenantId: number): Promise<I18nOverrides> {
  const redis = getDefaultRedis(env)
  const cacheKey = `${CACHE_PREFIX}${tenantId}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try { return JSON.parse(cached) as I18nOverrides } catch { /* 缓存脏了就回源 */ }
  }

  let overrides: I18nOverrides
  try {
    overrides = await queryOverrides(tenantId)
  } catch (err) {
    // 与品牌/开关一致：故障时不写缓存，本次按「无覆盖」处理。
    // 无覆盖 = 显示平台默认文案，站点仍可用；比返回空白文案安全得多。
    log.error({ err, tenantId }, '读取租户文案覆盖失败，本次按无覆盖处理')
    return {}
  }

  await redis.set(cacheKey, JSON.stringify(overrides), 'EX', CACHE_TTL_SECONDS)
  return overrides
}

export async function invalidateTenantI18nCache(env: Env, tenantId?: number): Promise<void> {
  const redis = getDefaultRedis(env)
  if (tenantId !== undefined) {
    await redis.del(`${CACHE_PREFIX}${tenantId}`)
    return
  }
  const keys = await scanKeys(redis, `${CACHE_PREFIX}*`)
  if (keys.length > 0) await redis.del(...keys)
}

export interface I18nOverrideRow {
  locale: string
  keyPath: string
  value: string
  updatedAt: string | null
}

export async function listTenantI18n(tenantId: number, locale?: string, search?: string): Promise<I18nOverrideRow[]> {
  const where: string[] = ['tenant_id = ?']
  const params: unknown[] = [tenantId]
  if (locale) { where.push('locale = ?'); params.push(locale) }
  if (search) { where.push('(key_path LIKE ? OR value LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT locale, key_path, value, updated_at FROM pf_tenant_i18n
      WHERE ${where.join(' AND ')} ORDER BY locale, key_path LIMIT 500`,
    params,
  )
  return rows.map((r) => ({
    locale: String(r.locale),
    keyPath: String(r.key_path),
    value: String(r.value),
    updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
  }))
}

export async function countTenantI18n(tenantId: number): Promise<number> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM pf_tenant_i18n WHERE tenant_id = ?', [tenantId])
  return Number(rows[0]?.n ?? 0)
}

export async function setTenantI18n(tenantId: number, locale: string, keyPath: string, value: string): Promise<void> {
  await getPlatformPool().query(
    `INSERT INTO pf_tenant_i18n (tenant_id, locale, key_path, value) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [tenantId, locale, keyPath, value],
  )
}

export async function deleteTenantI18n(tenantId: number, locale: string, keyPath: string): Promise<void> {
  await getPlatformPool().query(
    'DELETE FROM pf_tenant_i18n WHERE tenant_id = ? AND locale = ? AND key_path = ?',
    [tenantId, locale, keyPath],
  )
}
