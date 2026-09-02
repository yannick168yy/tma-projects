import mysql from 'mysql2/promise'
import type { Pool } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { currentTenantOrNull } from '../lib/tenant-context.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('mysql')

interface TenantPool {
  pool: Pool
  lastUsedAt: number
  selfOperated: boolean
}

const pools = new Map<string, TenantPool>()

// 空闲租户池回收：包网站点数量多但大部分时段没流量，
// 连接一直占着会挤爆 max_connections（当前服务器只有 50）
const IDLE_EVICT_MS = 30 * 60 * 1000
const EVICT_INTERVAL_MS = 5 * 60 * 1000
let evictTimer: NodeJS.Timeout | null = null

export function isMysqlEnabled(_env: Env): boolean {
  const mode = process.env.BFF_STORAGE?.trim().toLowerCase()
  if (mode === 'redis') return false
  if (mode === 'mysql') {
    return Boolean(process.env.MYSQL_HOST && process.env.MYSQL_PASSWORD)
  }
  return Boolean(process.env.MYSQL_HOST && process.env.MYSQL_PASSWORD)
}

export function getStorageMode(): 'mysql' | 'redis' {
  return isMysqlEnabled({} as Env) ? 'mysql' : 'redis'
}

/** 自营站库名。没有租户上下文时的回落目标，也是 warmup 的对象 */
export function defaultDatabase(): string {
  return process.env.MYSQL_DATABASE ?? 'betogo'
}

// 自营站沿用压测验证过的池 10；其他租户默认给 2，靠空闲回收控总量。
// 服务器 max_connections 目前是 50，接入真实包网客户前必须先调大。
function poolSizeFor(selfOperated: boolean): number {
  return selfOperated
    ? Number(process.env.MYSQL_POOL_SIZE ?? 10)
    : Number(process.env.MYSQL_TENANT_POOL_SIZE ?? 2)
}

function projectedConnections(): number {
  let total = 0
  for (const entry of pools.values()) total += poolSizeFor(entry.selfOperated)
  return total
}

function startEvictTimer(): void {
  if (evictTimer) return
  evictTimer = setInterval(() => {
    const deadline = Date.now() - IDLE_EVICT_MS
    for (const [database, entry] of pools) {
      // 自营站池常驻：它是唯一全天有流量的，回收了下次请求还要重连
      if (entry.selfOperated || entry.lastUsedAt > deadline) continue
      pools.delete(database)
      void entry.pool.end().catch((err) => log.warn({ err, database }, '空闲租户池关闭失败'))
      log.info({ database }, '回收空闲租户连接池')
    }
  }, EVICT_INTERVAL_MS)
  evictTimer.unref()
}

function poolForDatabase(database: string, selfOperated: boolean): Pool {
  const existing = pools.get(database)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing.pool
  }

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'betogo',
    password: process.env.MYSQL_PASSWORD,
    database,
    waitForConnections: true,
    connectionLimit: poolSizeFor(selfOperated),
    timezone: 'Z',
    charset: 'UTF8MB4_UNICODE_CI',
  })
  pools.set(database, { pool, lastUsedAt: Date.now(), selfOperated })
  if (!selfOperated) startEvictTimer()

  const budget = Number(process.env.MYSQL_TOTAL_CONN_BUDGET ?? 30)
  const projected = projectedConnections()
  if (projected > budget) {
    log.error(
      { database, poolCount: pools.size, projected, budget },
      '租户连接池总量已超预算，请调大 MySQL max_connections 或缩小单池 size',
    )
  }
  return pool
}

// 缺租户上下文的调用点只报一次，否则启动期和定时任务会把日志刷爆
const warnedCallSites = new Set<string>()
function warnMissingTenant(): void {
  const site = (new Error().stack ?? '').split('\n').slice(3, 6).join(' | ')
  if (warnedCallSites.has(site)) return
  if (warnedCallSites.size > 100) warnedCallSites.clear()
  warnedCallSites.add(site)
  log.warn({ site }, '无租户上下文，已回落自营站库；P0-7 前需把该调用点用 runWithTenant 包裹')
}

/**
 * 按当前租户取连接池。业务层 SQL 不用改 —— 这是选分库方案的核心收益。
 *
 * 没有租户上下文时（启动期、尚未租户化的定时任务）回落自营站库并按调用点告警一次，
 * 这份告警清单就是 P0-7 要逐个包裹的任务列表。
 * TENANT_RESOLVE_STRICT=true 时直接抛错，禁止任何回落。
 */
export function getMysqlPool(env: Env): Pool {
  if (!isMysqlEnabled(env)) {
    throw new Error('MySQL is not configured (MYSQL_HOST / MYSQL_PASSWORD)')
  }
  const tenant = currentTenantOrNull()
  if (!tenant) {
    if (process.env.TENANT_RESOLVE_STRICT === 'true') {
      throw new Error('[mysql] 当前执行链没有租户上下文，拒绝回落自营站库')
    }
    warnMissingTenant()
    return poolForDatabase(defaultDatabase(), true)
  }
  return poolForDatabase(tenant.database, tenant.selfOperated)
}

export async function warmupMysql(env: Env): Promise<void> {
  const p = poolForDatabase(defaultDatabase(), true)
  void env
  for (let i = 0; i < 6; i++) {
    try {
      const conn = await p.getConnection()
      conn.release()
      return
    } catch (err: unknown) {
      if (i === 5) throw err
      console.warn(`[mysql] connect failed (attempt ${i + 1}/6), retrying in 3s:`, (err as Error).message)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}

export async function closeMysql(): Promise<void> {
  if (evictTimer) {
    clearInterval(evictTimer)
    evictTimer = null
  }
  const entries = [...pools.values()]
  pools.clear()
  await Promise.all(entries.map((entry) => entry.pool.end()))
}

/** 仅测试用：清空池缓存与告警去重 */
export function __resetMysqlPoolsForTest(): void {
  pools.clear()
  warnedCallSites.clear()
  if (evictTimer) {
    clearInterval(evictTimer)
    evictTimer = null
  }
}
