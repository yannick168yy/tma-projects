import fp from 'fastify-plugin'
import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

declare module 'fastify' {
  interface FastifyInstance {
    mysql: mysql.Pool
  }
}

export default fp(async (app) => {
  const pool = mysql.createPool({
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    database: env.MYSQL_DATABASE,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    connectionLimit: 10,
    waitForConnections: true,
    timezone: '+00:00',
  })

  // 启动时主动建立连接，确保 DNS 已就绪（aardvark-dns 在容器重启后短暂不可用）
  for (let i = 0; i < 6; i++) {
    try {
      const conn = await pool.getConnection()
      conn.release()
      break
    } catch (err: unknown) {
      if (i === 5) throw err
      app.log.warn({ msg: (err as Error).message, attempt: i + 1 }, 'MySQL connect failed, retrying in 3s')
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  app.decorate('mysql', pool)

  app.addHook('onClose', async () => {
    await pool.end()
  })
}, { name: 'mysql' })
