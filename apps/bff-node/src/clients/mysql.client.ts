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
      connectionLimit: 10,
      timezone: 'Z',
    })
  }
  return pool
}

export async function closeMysql(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
