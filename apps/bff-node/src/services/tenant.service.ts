import type { Redis } from 'ioredis'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { scanKeys } from '../clients/redis.client.js'
import type { TenantContext, TenantStatus } from '../lib/tenant-context.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('tenant')

const CACHE_PREFIX = 'platform:tenant-by-host:'
const CACHE_TTL_SECONDS = 300
// 平台库抖动时的降级缓存只短存，避免一次 DB 故障把错误结果钉住 5 分钟
const FALLBACK_CACHE_TTL_SECONDS = 30
const MISS = '__miss__'

/** 归一化域名：去协议、去路径、去端口、去末尾点、去 www 前缀 */
export function normalizeHost(raw: string | undefined): string {
  if (!raw) return ''
  let host = raw.trim().toLowerCase()
  host = host.replace(/^[a-z]+:\/\//, '')
  host = host.replace(/\/.*$/, '')
  host = host.replace(/:\d+$/, '')
  host = host.replace(/\.$/, '')
  return host.replace(/^www\./, '')
}

interface TenantRow extends RowDataPacket {
  id: number
  code: string
  db_name: string
  status: TenantStatus
  self_operated: number
}

function toContext(row: TenantRow): TenantContext {
  return {
    id: row.id,
    code: row.code,
    database: row.db_name,
    status: row.status,
    selfOperated: row.self_operated === 1,
  }
}

async function queryByHost(host: string): Promise<TenantContext | null> {
  const [rows] = await getPlatformPool().query<TenantRow[]>(
    `SELECT t.id, t.code, t.db_name, t.status, t.self_operated
       FROM pf_tenant_domain d
       JOIN pf_tenant t ON t.id = d.tenant_id
      WHERE d.domain = ? AND d.enabled = 1
      LIMIT 1`,
    [host],
  )
  return rows[0] ? toContext(rows[0]) : null
}

/** 自营站兜底。P0 阶段只有它一个租户，未登记域名先落到这里而不是直接 404 */
export async function selfOperatedTenant(): Promise<TenantContext | null> {
  const [rows] = await getPlatformPool().query<TenantRow[]>(
    `SELECT id, code, db_name, status, self_operated
       FROM pf_tenant WHERE self_operated = 1 ORDER BY id LIMIT 1`,
  )
  return rows[0] ? toContext(rows[0]) : null
}

/**
 * Host → 租户。命中与未命中都进缓存（未命中存哨兵值），
 * 否则一个乱填 Host 的扫描器就能把平台库打满。
 */
export async function resolveTenantByHost(redis: Redis, rawHost: string | undefined): Promise<TenantContext | null> {
  const host = normalizeHost(rawHost)
  if (!host) return null

  const cacheKey = `${CACHE_PREFIX}${host}`
  const cached = await redis.get(cacheKey)
  if (cached === MISS) return null
  if (cached) {
    try { return JSON.parse(cached) as TenantContext } catch { /* 缓存脏了就回源 */ }
  }

  let tenant: TenantContext | null
  try {
    tenant = await queryByHost(host)
  } catch (err) {
    // 容器重启后 aardvark-dns 有几秒抖动，池现开新连接会 ENOTFOUND。
    // 重试一次能盖住绝大部分，剩下的才当故障处理。
    try {
      await new Promise((r) => setTimeout(r, 300))
      tenant = await queryByHost(host)
    } catch (retryErr) {
      // 平台库不可用时不缓存任何结论，避免把故障态钉进缓存
      log.error({ err: retryErr, host }, '平台库查询租户失败（含一次重试）')
      return null
    }
  }

  await redis.set(
    cacheKey,
    tenant ? JSON.stringify(tenant) : MISS,
    'EX',
    tenant ? CACHE_TTL_SECONDS : FALLBACK_CACHE_TTL_SECONDS,
  )
  return tenant
}

/** 域名或租户状态变更后调用，避免等 5 分钟缓存自然过期 */
export async function invalidateTenantHostCache(redis: Redis, rawHost?: string): Promise<void> {
  const host = normalizeHost(rawHost)
  if (host) {
    await redis.del(`${CACHE_PREFIX}${host}`)
    return
  }
  const keys = await scanKeys(redis, `${CACHE_PREFIX}*`)
  if (keys.length > 0) await redis.del(...keys)
}
