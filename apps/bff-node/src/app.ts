import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import type { Env } from './config/env.js'
import { getRedis } from './clients/redis.client.js'
import { errorHandler } from './middleware/errorHandler.js'
import { injectDeps, requestIdMiddleware } from './middleware/requestId.js'
import { createApiRouter } from './routes/index.js'
import { initStore } from './services/store/index.js'
import { pollAndSettleTonDeposits } from './services/ton.service.js'
import { syncAllGames } from './services/sg-game.service.js'
import { isMysqlEnabled } from './clients/mysql.client.js'
import { ok } from './utils/response.js'
import { seedDefaultAdmin } from './services/admin-auth.service.js'

export function createApp(env: Env): Koa {
  const app = new Koa()
  app.proxy = true  // 信任 nginx 的 X-Forwarded-For，ctx.ip 才能拿到真实用户 IP
  initStore(env)
  const redis = getRedis(env)

  // TON deposit poller: every 30s
  setInterval(() => {
    pollAndSettleTonDeposits(redis, env).catch((err) =>
      console.error('[ton-poller] unhandled error:', err),
    )
  }, 30_000)

  // Seed default admin account — retry with backoff until MySQL is reachable
  if (isMysqlEnabled(env)) {
    const trySeed = (attempt: number): void => {
      seedDefaultAdmin(env).catch((err) => {
        if (attempt < 8) {
          const delay = Math.min(5_000 * (attempt + 1), 30_000)
          setTimeout(() => trySeed(attempt + 1), delay)
        } else {
          console.error('[admin-seed] error:', err)
        }
      })
    }
    setTimeout(() => trySeed(0), 10_000)
  }

  // Slotegrator game sync: on startup then every 6h
  if (isMysqlEnabled(env) && env.SG_BASE_URL && env.SG_MERCHANT_ID) {
    const runSync = () =>
      syncAllGames(env)
        .then(({ synced }) => console.log(`[sg-sync] synced ${synced} games`))
        .catch((err) => console.error('[sg-sync] error:', err))
    setTimeout(runSync, 10_000) // 10s after startup
    setInterval(runSync, 6 * 60 * 60 * 1000) // every 6h
  }

  app.use(errorHandler())
  app.use(
    cors({
      origin: (ctx) => ctx.get('Origin') || '*',
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Init-Data', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id'],
    }),
  )
  app.use(bodyParser())
  app.use(requestIdMiddleware())
  app.use(injectDeps(env, redis))

  app.use(async (ctx, next) => {
    if (ctx.path === '/health') {
      ok(ctx, { status: 'ok', service: 'bff-node' })
      return
    }
    await next()
  })

  const api = createApiRouter()
  app.use(api.routes())
  app.use(api.allowedMethods())

  app.use(async (ctx) => {
    ctx.status = 404
    ctx.body = { code: 404, message: 'Not found', data: null, traceId: ctx.state.traceId }
  })

  return app
}
