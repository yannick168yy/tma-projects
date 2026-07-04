import { bootstrapEnv } from './config/bootstrap.js'
import { createApp } from './app.js'
import { logger } from './lib/logger.js'
import { closeRedis } from './clients/redis.client.js'
import { closeMysql, getStorageMode, warmupMysql, isMysqlEnabled } from './clients/mysql.client.js'

const env = await bootstrapEnv()

process.on('beforeExit', (code) => {
  logger.warn({ code }, 'process beforeExit')
})

process.on('exit', (code) => {
  logger.warn({ code }, 'process exit')
})

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection')
})

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception')
  process.exit(1)
})

if (isMysqlEnabled(env)) {
  try {
    await warmupMysql(env)
  } catch (err) {
    logger.error({ err }, 'mysql warmup failed, starting server anyway')
  }
}

const app = createApp(env)

const server = app.listen(env.BFF_PORT, () => {
  const nacos = Boolean(process.env.NACOS_SERVER_ADDR?.trim())
  logger.info({ port: env.BFF_PORT, storage: getStorageMode(), nacos }, 'listening')
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  server.close()
  await closeRedis()
  await closeMysql()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
