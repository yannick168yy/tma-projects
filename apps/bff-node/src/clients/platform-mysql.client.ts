import mysql from 'mysql2/promise'
import type { Pool } from 'mysql2/promise'

let pool: Pool | null = null

export function platformDatabase(): string {
  return process.env.MYSQL_PLATFORM_DATABASE?.trim() || 'betogo_platform'
}

/**
 * 平台库连接池。与租户库分开：平台库只有租户/域名/套餐/计费这类跨租户数据，
 * 连接数很小，且不能随请求切库，所以不走 getMysqlPool 的按租户路由。
 */
export function getPlatformPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'betogo',
      password: process.env.MYSQL_PASSWORD,
      database: platformDatabase(),
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_PLATFORM_POOL_SIZE ?? 4),
      timezone: 'Z',
      charset: 'UTF8MB4_UNICODE_CI',
    })
  }
  return pool
}

/**
 * 启动预热。容器刚起时 podman DNS 常有几秒未就绪（与 warmupMysql 同一问题），
 * 不预热的话最初几秒的请求全部解析不到租户，strict 模式下会直接 404。
 */
export async function warmupPlatformMysql(): Promise<void> {
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
      console.warn(`[platform-mysql] connect failed (attempt ${i + 1}/6), retrying in 3s:`, (err as Error).message)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

export async function closePlatformMysql(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
