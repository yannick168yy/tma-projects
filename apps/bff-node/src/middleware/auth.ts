import type { Middleware } from 'koa'
import { getSession } from '../services/store.js'
import { fail } from '../utils/response.js'

export function authMiddleware(): Middleware {
  return async (ctx, next) => {
    const auth = ctx.get('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      fail(ctx, 401, 'Unauthorized', 401)
      return
    }
    const token = auth.slice(7)
    const session = await getSession(ctx.state.redis, token)
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      fail(ctx, 401, 'Session expired', 401)
      return
    }
    ctx.state.userId = session.userId
    ctx.state.token = token
    await next()
  }
}

export function optionalAuthMiddleware(): Middleware {
  return async (ctx, next) => {
    const auth = ctx.get('Authorization')
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice(7)
      const session = await getSession(ctx.state.redis, token)
      if (session && new Date(session.expiresAt).getTime() > Date.now()) {
        ctx.state.userId = session.userId
        ctx.state.token = token
      }
    }
    await next()
  }
}

declare module 'koa' {
  interface DefaultState {
    traceId: string
    env: import('../config/env.js').Env
    redis: import('ioredis').Redis
    userId?: string
    token?: string
  }
}
