import mysql from 'mysql2/promise'
import type { Pool } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { currentTenantOrNull, type TenantContext, type TenantPoolConfig } from '../lib/tenant-context.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('mysql')

interface TenantPool {
  pool: Pool
  lastUsedAt: number
  selfOperated: boolean
  config: TenantPoolConfig
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

/**
 * 池配置来源优先级：平台库 pf_tenant 的每租户配置 → 环境变量默认值。
 * 每租户可配的意义：试用站和旗舰客户不该拿同样的资源；
 * 而租户少的时候不该限制，默认给足，扛不住再按租户下调。
 */
function resolvePoolConfig(tenant: TenantContext | null): TenantPoolConfig {
  if (tenant?.pool) return tenant.pool
  const selfOperated = !tenant || tenant.selfOperated
  return {
    min: Number(process.env.MYSQL_POOL_MIN ?? 2),
    max: selfOperated
      ? Number(process.env.MYSQL_POOL_SIZE ?? 10)
      : Number(process.env.MYSQL_TENANT_POOL_SIZE ?? 10),
    queueLimit: Number(process.env.MYSQL_QUEUE_LIMIT ?? 0),
  }
}

function projectedConnections(): number {
  let total = 0
  for (const entry of pools.values()) total += entry.config.max
  return total
}

/**
 * 顺序预热到 min 条常驻连接。
 * 必须顺序、必须后台执行：并发 Promise.all 取连接一旦有一条失败，
 * 其余 pending 的 getConnection 会占死池槽，重试时 waitForConnections 永久等待
 * —— 这个坑在 P0-5 造成过测试站 502。
 */
function prewarm(pool: Pool, database: string, min: number): void {
  if (min <= 0) return
  void (async () => {
    // 容器刚起时 aardvark-dns 有几秒不可用，第一轮必失败。
    // 重试几轮而不是直接放弃，否则「常驻连接」在每次重启后都要等真实流量才建起来。
    for (let round = 1; round <= 5; round++) {
      let established = 0
      let lastErr: unknown
      for (let i = 0; i < min; i++) {
        try {
          const conn = await pool.getConnection()
          conn.release()
          established++
        } catch (err) {
          lastErr = err
          break
        }
      }
      if (established >= min) return
      if (round === 5) {
        log.warn({ err: lastErr, database, established, min }, '连接池预热未完成，后续按需建连')
        return
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  })()
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

function poolForDatabase(database: string, selfOperated: boolean, config: TenantPoolConfig): Pool {
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
    connectionLimit: config.max,
    // maxIdle 是 mysql2 里最接近「最小连接数」的语义：空闲连接保留这么多不回收，
    // 配合 prewarm 就等价于「初始 min 条常驻」
    maxIdle: Math.min(config.min, config.max),
    queueLimit: config.queueLimit,
    timezone: 'Z',
    charset: 'UTF8MB4_UNICODE_CI',
  })
  pools.set(database, { pool, lastUsedAt: Date.now(), selfOperated, config })
  prewarm(pool, database, Math.min(config.min, config.max))
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
    return poolForDatabase(defaultDatabase(), true, resolvePoolConfig(null))
  }
  return poolForDatabase(tenant.database, tenant.selfOperated, resolvePoolConfig(tenant))
}

/**
 * 丢弃某个租户的池，下次请求按新配置重建。
 * 连接池的 connectionLimit / maxIdle 在创建时固定，改配置只能重建池才生效。
 */
export function dropTenantPool(database: string): boolean {
  const entry = pools.get(database)
  if (!entry) return false
  pools.delete(database)
  void entry.pool.end().catch((err) => log.warn({ err, database }, '重建前关闭旧池失败'))
  log.info({ database }, '连接池配置变更，已丢弃旧池')
  return true
}

export async function warmupMysql(env: Env): Promise<void> {
  const p = poolForDatabase(defaultDatabase(), true, resolvePoolConfig(null))
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
