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

  app.decorate('mysql', pool)

  app.addHook('onClose', async () => {
    await pool.end()
  })
}, { name: 'mysql' })
