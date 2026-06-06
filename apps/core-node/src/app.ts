import Fastify from 'fastify'
import fastifyRedis from '@fastify/redis'
import natsPlugin from './plugins/nats.js'
import mysqlPlugin from './plugins/mysql.js'
import { registerRoutes } from './routes/index.js'
import { startLedgerConsumer } from './consumers/ledger.consumer.js'
import { startCallbackConsumer } from './consumers/callback.consumer.js'
import { startSettlementCron } from './cron/settlement.cron.js'
import { env } from './config/env.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
      base: { service: 'core-node' },
      transport: env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  await app.register(fastifyRedis, { url: env.REDIS_URL, closeClient: true })
  // ioredis 断线重连失败时会 emit 'error'，若无 handler 会触发 uncaughtException 杀死进程
  app.redis.on('error', (err: Error) => {
    app.log.error({ err: err.message }, 'Redis client error')
  })
  await app.register(mysqlPlugin)
  await app.register(natsPlugin)

  await registerRoutes(app)

  app.addHook('onReady', async () => {
    await startLedgerConsumer(app)
    await startCallbackConsumer(app)
    startSettlementCron(app)
  })

  return app
}
