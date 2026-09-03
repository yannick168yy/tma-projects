import mysql from 'mysql2/promise'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import type { TenantContext, TenantStatus } from '../lib/tenant-context.js'

let pool: Pool | null = null

export function getPlatformPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      database: process.env.MYSQL_PLATFORM_DATABASE?.trim() || 'betogo_platform',
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      connectionLimit: Number(process.env.MYSQL_PLATFORM_POOL_SIZE ?? 4),
      waitForConnections: true,
      timezone: '+00:00',
    })
  }
  return pool
}

interface TenantRow extends RowDataPacket {
  id: number
  code: string
  db_name: string
  status: TenantStatus
  self_operated: number
  pool_min: number
  pool_max: number
  queue_limit: number
}

const SELECT_COLUMNS = 't.id, t.code, t.db_name, t.status, t.self_operated, t.pool_min, t.pool_max, t.queue_limit'

function toContext(row: TenantRow): TenantContext {
  return {
    id: row.id,
    code: row.code,
    database: row.db_name,
    status: row.status,
    selfOperated: row.self_operated === 1,
    pool: { min: row.pool_min, max: row.pool_max, queueLimit: row.queue_limit },
  }
}

export function normalizeHost(raw: string | undefined): string {
  if (!raw) return ''
  let host = raw.trim().toLowerCase()
  host = host.replace(/^[a-z]+:\/\//, '')
  host = host.replace(/\/.*$/, '')
  host = host.replace(/:\d+$/, '')
  host = host.replace(/\.$/, '')
  return host.replace(/^www\./, '')
}

export async function tenantByCode(code: string): Promise<TenantContext | null> {
  const [rows] = await getPlatformPool().query<TenantRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM pf_tenant t WHERE t.code = ? LIMIT 1`,
    [code],
  )
  return rows[0] ? toContext(rows[0]) : null
}

export async function tenantByHost(host: string): Promise<TenantContext | null> {
  const [rows] = await getPlatformPool().query<TenantRow[]>(
    `SELECT ${SELECT_COLUMNS}
       FROM pf_tenant_domain d JOIN pf_tenant t ON t.id = d.tenant_id
      WHERE d.domain = ? AND d.enabled = 1 LIMIT 1`,
    [host],
  )
  return rows[0] ? toContext(rows[0]) : null
}

export async function selfOperatedTenant(): Promise<TenantContext | null> {
  const [rows] = await getPlatformPool().query<TenantRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM pf_tenant t WHERE t.self_operated = 1 ORDER BY t.id LIMIT 1`,
  )
  return rows[0] ? toContext(rows[0]) : null
}

/** 启动预热：容器刚起时 aardvark-dns 有几秒未就绪，不预热会让最初几个回调解析不到租户 */
export async function warmupPlatformPool(): Promise<void> {
  const p = getPlatformPool()
  for (let i = 0; i < 6; i++) {
    try {
      // 只建一条：并发预建满池时，一旦有一条失败，其余 getConnection 仍占着池槽，
      // 重试就会在 waitForConnections 上永久等待，把启动卡死
      const conn = await p.getConnection()
      conn.release()
      return
    } catch (err: unknown) {
      if (i === 5) throw err
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

export async function closePlatformPool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
