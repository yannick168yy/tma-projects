import { loadEnv } from './config/env.js'
import { createApp } from './app.js'
import { closeRedis } from './clients/redis.client.js'

const env = loadEnv()
const app = createApp(env)

const server = app.listen(env.BFF_PORT, () => {
  console.log(`[bff-node] listening on :${env.BFF_PORT}`)
})

async function shutdown(signal: string) {
  console.log(`[bff-node] ${signal} received, shutting down`)
  server.close()
  await closeRedis()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
