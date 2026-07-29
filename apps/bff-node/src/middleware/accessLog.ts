import type { Middleware } from 'koa'
import { logger } from '../lib/logger.js'

export function accessLogMiddleware(): Middleware {
  return async (ctx, next) => {
    const start = Date.now()
    await next()
    const ms = Date.now() - start
    const path = ctx.path
    if (path === '/health') return

    const level = ctx.status >= 500 ? 'error' : ctx.status >= 400 ? 'warn' : 'info'
    logger[level]({
      traceId: ctx.state.traceId,
      method: ctx.method,
      path,
      status: ctx.status,
      ms,
      ip: ctx.ip,
      userId: ctx.state.userId,
    }, 'http')
  }
}
