import type { Middleware } from 'koa'
import { randomUUID } from 'node:crypto'
import type { AppState } from '../types/context.js'

export function requestIdMiddleware(): Middleware {
  return async (ctx, next) => {
    const traceId =
      (typeof ctx.get('X-Request-Id') === 'string' && ctx.get('X-Request-Id')) || randomUUID()
    ctx.set('X-Request-Id', traceId)
    ctx.state.traceId = traceId
    await next()
  }
}

export function injectDeps(env: AppState['env'], redis: AppState['redis']): Middleware {
  return async (ctx, next) => {
    ctx.state.env = env
    ctx.state.redis = redis
    await next()
  }
}
