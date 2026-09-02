import type { Middleware } from 'koa'
import { randomUUID } from 'node:crypto'
import type { AppState } from '../types/context.js'
import { getRedis } from '../clients/redis.client.js'

export function requestIdMiddleware(): Middleware {
  return async (ctx, next) => {
    const traceId =
      (typeof ctx.get('X-Request-Id') === 'string' && ctx.get('X-Request-Id')) || randomUUID()
    ctx.set('X-Request-Id', traceId)
    ctx.state.traceId = traceId
    await next()
  }
}

// 必须排在租户中间件之后：ctx.state.redis 要按当前租户拿带 keyPrefix 的客户端
export function injectDeps(env: AppState['env']): Middleware {
  return async (ctx, next) => {
    ctx.state.env = env
    ctx.state.redis = getRedis(env)
    await next()
  }
}
