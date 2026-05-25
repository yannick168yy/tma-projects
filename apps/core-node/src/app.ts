import Fastify from 'fastify'
import fastifyRedis from '@fastify/redis'
import natsPlugin from './plugins/nats.js'
import mysqlPlugin from './plugins/mysql.js'
import { registerRoutes } from './routes/index.js'
import { startLedgerConsumer } from './consumers/ledger.consumer.js'
import { env } from './config/env.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  await app.register(fastifyRedis, { url: env.REDIS_URL, closeClient: true })
  await app.register(mysqlPlugin)
  await app.register(natsPlugin)

  await registerRoutes(app)

  app.addHook('onReady', async () => {
    await startLedgerConsumer(app)
  })

  return app
}
