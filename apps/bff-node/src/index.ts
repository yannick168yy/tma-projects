import { bootstrapEnv } from './config/bootstrap.js'
import { createApp } from './app.js'
import { closeRedis } from './clients/redis.client.js'
import { closeMysql, getStorageMode } from './clients/mysql.client.js'

const env = await bootstrapEnv()
const app = createApp(env)

const server = app.listen(env.BFF_PORT, () => {
  const nacos = Boolean(process.env.NACOS_SERVER_ADDR?.trim())
  console.log(
    `[bff-node] listening on :${env.BFF_PORT} storage=${getStorageMode()} nacos=${nacos}`,
  )
})

async function shutdown(signal: string) {
  console.log(`[bff-node] ${signal} received, shutting down`)
  server.close()
  await closeRedis()
  await closeMysql()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
