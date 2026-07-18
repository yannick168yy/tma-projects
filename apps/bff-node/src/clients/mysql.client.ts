import mysql from 'mysql2/promise'
import type { Pool } from 'mysql2/promise'
import type { Env } from '../config/env.js'

let pool: Pool | null = null

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

export function getMysqlPool(env: Env): Pool {
  if (!isMysqlEnabled(env)) {
    throw new Error('MySQL is not configured (MYSQL_HOST / MYSQL_PASSWORD)')
  }
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'betogo',
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE ?? 'betogo',
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_POOL_SIZE ?? 10),
      timezone: 'Z',
      charset: 'UTF8MB4_UNICODE_CI',
    })
  }
  return pool
}

export async function warmupMysql(env: Env): Promise<void> {
  const p = getMysqlPool(env)
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
  if (pool) {
    await pool.end()
    pool = null
  }
}
