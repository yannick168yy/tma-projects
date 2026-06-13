import Router from '@koa/router'
import type { PasswordMethod } from '../services/auth.service.js'
import { AuthError, loginWithGoogleCode, loginWithInitData, loginWithPassword, loginWithTelegramWidget, logout, refreshSession, registerWithPassword, resolveSession, toAuthUser } from '../services/auth.service.js'
import { recordUserLogin } from '../services/store/index.js'
import { lookupRegion } from '../services/geo.service.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/auth' })

function cleanIp(raw: string): string {
  return raw.replace(/^::ffff:/i, '')
}

const LOGIN_MAX_FAILS = 5
const LOGIN_WINDOW_SEC = 600

function isPasswordMethod(m: unknown): m is PasswordMethod {
  return m === 'phone' || m === 'account'
}

router.post('/telegram', async (ctx) => {
  const body = ctx.request.body as { initData?: string; start_param?: string }
  const initData = ctx.get('X-Telegram-Init-Data') || body.initData || ''
  try {
    const ip = cleanIp(ctx.ip)
    const result = await loginWithInitData(ctx.state.redis, ctx.state.env, initData, body.start_param, ip)
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: toAuthUser(result.user),
    })
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      userAgent: ctx.get('user-agent'),
      authMethod: 'telegram',
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      fail(ctx, 401, e.message, 401)
      return
    }
    throw e
  }
})

router.post('/google', async (ctx) => {
  const body = ctx.request.body as { code?: string; redirectUri?: string; referralCode?: string }
  if (!body.code || !body.redirectUri) {
    fail(ctx, 400, 'code and redirectUri are required')
    return
  }
  try {
    const ip = cleanIp(ctx.ip)
    const result = await loginWithGoogleCode(
      ctx.state.redis,
      ctx.state.env,
      body.code,
      body.redirectUri,
      ip,
      body.referralCode,
    )
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: toAuthUser(result.user),
    })
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      userAgent: ctx.get('user-agent'),
      authMethod: 'google',
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      fail(ctx, 401, e.message, 401)
      return
    }
    throw e
  }
})

router.post('/register', async (ctx) => {
  const body = ctx.request.body as { method?: string; identifier?: string; password?: string; referralCode?: string }
  if (!isPasswordMethod(body.method) || !body.identifier || !body.password) {
    fail(ctx, 400, 'method, identifier and password are required')
    return
  }
  try {
    const ip = cleanIp(ctx.ip)
    const result = await registerWithPassword(
      ctx.state.redis,
      ctx.state.env,
      { method: body.method, identifier: body.identifier, password: body.password, referralCode: body.referralCode },
      ip,
    )
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: toAuthUser(result.user),
    })
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      userAgent: ctx.get('user-agent'),
      authMethod: body.method,
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.status ?? 400
      fail(ctx, status, e.message, status)
      return
    }
    throw e
  }
})

router.post('/login', async (ctx) => {
  const body = ctx.request.body as { method?: string; identifier?: string; password?: string }
  if (!isPasswordMethod(body.method) || !body.identifier || !body.password) {
    fail(ctx, 400, 'method, identifier and password are required')
    return
  }
  const ip = cleanIp(ctx.ip)
  const throttleKey = `auth:login:fails:${ip}:${body.method}:${body.identifier}`
  const fails = Number((await ctx.state.redis.get(throttleKey)) ?? 0)
  if (fails >= LOGIN_MAX_FAILS) {
    fail(ctx, 429, '尝试次数过多，请稍后再试', 429)
    return
  }
  try {
    const result = await loginWithPassword(ctx.state.redis, ctx.state.env, {
      method: body.method,
      identifier: body.identifier,
      password: body.password,
    })
    await ctx.state.redis.del(throttleKey)
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: toAuthUser(result.user),
    })
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      userAgent: ctx.get('user-agent'),
      authMethod: body.method,
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      const n = await ctx.state.redis.incr(throttleKey)
      if (n === 1) await ctx.state.redis.expire(throttleKey, LOGIN_WINDOW_SEC)
      fail(ctx, 401, e.message, 401)
      return
    }
    throw e
  }
})

router.post('/telegram-widget', async (ctx) => {
  const body = ctx.request.body as Record<string, string> & { referralCode?: string }
  if (!body?.id || !body?.hash) {
    fail(ctx, 400, 'Invalid Telegram login payload')
    return
  }
  try {
    const ip = cleanIp(ctx.ip)
    const { referralCode, ...data } = body
    const result = await loginWithTelegramWidget(ctx.state.redis, ctx.state.env, data, ip, referralCode)
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: toAuthUser(result.user),
    })
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      userAgent: ctx.get('user-agent'),
      authMethod: 'telegram',
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      fail(ctx, e.status ?? 401, e.message, e.status ?? 401)
      return
    }
    throw e
  }
})

router.get('/session', async (ctx) => {
  const auth = ctx.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    ok(ctx, { valid: false })
    return
  }
  const session = await resolveSession(ctx.state.redis, auth.slice(7))
  ok(ctx, session)
})

router.post('/refresh', async (ctx) => {
  const auth = ctx.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    fail(ctx, 401, 'Unauthorized', 401)
    return
  }
  const refreshed = await refreshSession(ctx.state.redis, ctx.state.env, auth.slice(7))
  if (!refreshed) {
    fail(ctx, 401, 'Session expired', 401)
    return
  }
  ok(ctx, refreshed)
})

router.post('/logout', async (ctx) => {
  const auth = ctx.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    await logout(ctx.state.redis, auth.slice(7))
  }
  ok(ctx, null)
})

export default router
