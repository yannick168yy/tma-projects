import fp from 'fastify-plugin'
import mysql from 'mysql2/promise'
import { env } from '../config/env.js'
import { currentTenantOrNull, type TenantContext, type TenantPoolConfig } from '../lib/tenant-context.js'

declare module 'fastify' {
  interface FastifyInstance {
    mysql: mysql.Pool
  }
}

interface TenantPool {
  pool: mysql.Pool
  lastUsedAt: number
  selfOperated: boolean
  config: TenantPoolConfig
}

const pools = new Map<string, TenantPool>()
const IDLE_EVICT_MS = 30 * 60 * 1000
const EVICT_INTERVAL_MS = 5 * 60 * 1000

// 池配置优先取平台库的每租户配置，取不到才回落环境变量
function resolvePoolConfig(tenant: TenantContext | null): TenantPoolConfig {
  if (tenant?.pool) return tenant.pool
  return {
    min: Number(process.env.CORE_POOL_MIN ?? 2),
    max: Number(process.env.CORE_POOL_SIZE ?? 10),
    queueLimit: Number(process.env.CORE_QUEUE_LIMIT ?? 0),
  }
}

// 顺序预热，且必须后台执行：并发取连接失败会占死池槽导致永久等待（P0-5 踩过）
function prewarm(pool: mysql.Pool, min: number): void {
  if (min <= 0) return
  void (async () => {
    // 容器刚起时 DNS 有几秒不可用，重试几轮，否则常驻连接要等真实流量才建起来
    for (let round = 1; round <= 5; round++) {
      let established = 0
      for (let i = 0; i < min; i++) {
        try {
          const conn = await pool.getConnection()
          conn.release()
          established++
        } catch { break }
      }
      if (established >= min || round === 5) return
      await new Promise((r) => setTimeout(r, 3000))
    }
  })()
}

function poolForDatabase(database: string, selfOperated: boolean, config: TenantPoolConfig): mysql.Pool {
  const existing = pools.get(database)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing.pool
  }
  const pool = mysql.createPool({
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    database,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    connectionLimit: config.max,
    // maxIdle 是 mysql2 里最接近「最小连接数」的语义
    maxIdle: Math.min(config.min, config.max),
    queueLimit: config.queueLimit,
    waitForConnections: true,
    timezone: '+00:00',
  })
  pools.set(database, { pool, lastUsedAt: Date.now(), selfOperated, config })
  prewarm(pool, Math.min(config.min, config.max))
  return pool
}

export default fp(async (app) => {
  // 自营站池预建：回调链路对延迟敏感，不能等第一个请求现连
  const defaultPool = poolForDatabase(env.MYSQL_DATABASE, true, resolvePoolConfig(null))

  // 启动时主动建立连接，确保 DNS 已就绪（aardvark-dns 在容器重启后短暂不可用）
  for (let i = 0; i < 6; i++) {
    try {
      const conn = await defaultPool.getConnection()
      conn.release()
      break
    } catch (err: unknown) {
      if (i === 5) throw err
      app.log.warn({ msg: (err as Error).message, attempt: i + 1 }, 'MySQL connect failed, retrying in 3s')
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // getter 装饰器：现有 33 处 app.mysql 调用不用改，自动按当前租户取池。
  // 无上下文（消费者、定时任务）时用自营站池，P0-7 再逐个包裹。
  app.decorate('mysql', {
    getter: () => {
      const tenant = currentTenantOrNull()
      if (!tenant) return defaultPool
      return poolForDatabase(tenant.database, tenant.selfOperated, resolvePoolConfig(tenant))
    },
  })

  const evictTimer = setInterval(() => {
    const deadline = Date.now() - IDLE_EVICT_MS
    for (const [database, entry] of pools) {
      if (entry.selfOperated || entry.lastUsedAt > deadline) continue
      pools.delete(database)
      void entry.pool.end().catch((err: unknown) => app.log.warn({ err, database }, '空闲租户池关闭失败'))
      app.log.info({ database }, '回收空闲租户连接池')
    }
  }, EVICT_INTERVAL_MS)
  evictTimer.unref()

  app.addHook('onClose', async () => {
    clearInterval(evictTimer)
    const entries = [...pools.values()]
    pools.clear()
    await Promise.all(entries.map((entry) => entry.pool.end()))
  })
}, { name: 'mysql' })
