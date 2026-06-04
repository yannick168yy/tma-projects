import type { Middleware } from 'koa'
import { AuthError } from '../services/auth.service.js'
import { fail } from '../utils/response.js'
import { logger } from '../lib/logger.js'

export function errorHandler(): Middleware {
  return async (ctx, next) => {
    try {
      await next()
    } catch (err) {
      if (err instanceof AuthError) {
        fail(ctx, 401, err.message, 401)
        return
      }
      const message = err instanceof Error ? err.message : 'Internal server error'
      logger.error({ traceId: ctx.state.traceId, err }, 'request failed')
      fail(ctx, 500, message, 500)
    }
  }
}
