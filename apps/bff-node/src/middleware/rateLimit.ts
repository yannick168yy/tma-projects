import type { Middleware } from 'koa'
import { fail } from '../utils/response.js'

interface Rule {
  name: string
  match: (ctx: import('koa').Context) => boolean
  windowSec: number
  max: number
  keyBy: (ctx: import('koa').Context) => string
}

const cleanIp = (raw: string) => raw.replace(/^::ffff:/i, '')

const ipKey = (ctx: import('koa').Context) => cleanIp(ctx.ip || 'unknown')
const userOrIpKey = (ctx: import('koa').Context) => ctx.state.userId ?? ipKey(ctx)

const rules: Rule[] = [
  {
    name: 'admin-login',
    match: (ctx) =>
      ctx.method === 'POST' &&
      (ctx.path === '/api/v1/admin/auth/login' || ctx.path === '/api/v1/admin/auth/login/totp'),
    windowSec: 60,
    max: 10,
    keyBy: ipKey,
  },
  {
    name: 'auth',
    match: (ctx) => ctx.path.startsWith('/api/v1/auth/'),
    windowSec: 60,
    max: 30,
    keyBy: ipKey,
  },
  {
    name: 'kyc',
    match: (ctx) => ctx.path.startsWith('/api/v1/kyc/'),
    windowSec: 60,
    max: 20,
    keyBy: userOrIpKey,
  },
  {
    name: 'game-launch',
    match: (ctx) =>
      ctx.method === 'POST' &&
      (ctx.path === '/api/v1/slots/init' || ctx.path === '/api/v1/slots/demo'),
    windowSec: 60,
    max: 20,
    keyBy: userOrIpKey,
  },
  {
    name: 'withdraw',
    match: (ctx) => ctx.method === 'POST' && ctx.path === '/api/v1/withdrawals',
    windowSec: 60,
    max: 5,
    keyBy: userOrIpKey,
  },
  {
    name: 'promo',
    match: (ctx) =>
      ctx.method === 'POST' &&
      (ctx.path.includes('/promotions/') || ctx.path === '/api/v1/spin/draw'),
    windowSec: 60,
    max: 10,
    keyBy: userOrIpKey,
  },
  {
    name: 'api',
    match: (ctx) => ctx.path.startsWith('/api/'),
    windowSec: 60,
    max: 300,
    keyBy: ipKey,
  },
]

export function rateLimitMiddleware(): Middleware {
  return async (ctx, next) => {
    const rule = rules.find((item) => item.match(ctx))
    if (!rule) {
      await next()
      return
    }

    const key = `rl:${rule.name}:${rule.keyBy(ctx)}:${Math.floor(Date.now() / (rule.windowSec * 1000))}`
    const count = await ctx.state.redis.incr(key)
    if (count === 1) await ctx.state.redis.expire(key, rule.windowSec + 2)
    if (count > rule.max) {
      ctx.set('Retry-After', String(rule.windowSec))
      fail(ctx, 429, 'errors.tooManyRequests', 429)
      return
    }

    await next()
  }
}
