import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import type { Env } from './config/env.js'
import { getRedis } from './clients/redis.client.js'
import { errorHandler } from './middleware/errorHandler.js'
import { injectDeps, requestIdMiddleware } from './middleware/requestId.js'
import { createApiRouter } from './routes/index.js'
import { initStore } from './services/store/index.js'
import { ok } from './utils/response.js'

export function createApp(env: Env): Koa {
  const app = new Koa()
  initStore(env)
  const redis = getRedis(env)

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
