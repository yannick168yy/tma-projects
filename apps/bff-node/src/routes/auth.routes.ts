import Router from '@koa/router'
import { AuthError, loginWithGoogleCode, loginWithInitData, logout, refreshSession, resolveSession, toAuthUser } from '../services/auth.service.js'
import { recordUserLogin } from '../services/store/index.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/auth' })

router.post('/telegram', async (ctx) => {
  const body = ctx.request.body as { initData?: string; start_param?: string }
  const initData = ctx.get('X-Telegram-Init-Data') || body.initData || ''
  try {
    const result = await loginWithInitData(ctx.state.redis, ctx.state.env, initData, body.start_param)
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: toAuthUser(result.user),
    })
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip: ctx.ip,
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
  const body = ctx.request.body as { code?: string; redirectUri?: string }
  if (!body.code || !body.redirectUri) {
    fail(ctx, 400, 'code and redirectUri are required')
    return
  }
  try {
    const result = await loginWithGoogleCode(
      ctx.state.redis,
      ctx.state.env,
      body.code,
      body.redirectUri,
    )
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: toAuthUser(result.user),
    })
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip: ctx.ip,
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
