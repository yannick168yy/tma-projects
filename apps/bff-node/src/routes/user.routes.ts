import Router from '@koa/router'
import { getUser, getUserByEmail, saveUser } from '../services/store.js'
import { toPublicUser } from '../services/userPresentation.js'
import { AuthError, bindAccount, bindGoogleAccount, bindPhone, bindTelegramOidc, bindTelegramWidget } from '../services/auth.service.js'
import { isAppLocale } from '../types/locale.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/user' })

function handleBindError(ctx: import('koa').Context, e: unknown): boolean {
  if (e instanceof AuthError) {
    fail(ctx, e.status ?? 400, e.message, e.status ?? 400)
    return true
  }
  return false
}

router.get('/me', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  ok(ctx, {
    ...toPublicUser(user),
    registeredAt: user.registeredAt,
    locale: user.locale,
    profile: user.profile,
  })
})

router.get('/status', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  ok(ctx, {
    status: user.status,
    reason: user.statusReason ?? null,
  })
})

router.patch('/me', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  const body = ctx.request.body as Partial<typeof user.profile>
  // 邮箱跨账号唯一
  if (body.email && body.email !== user.email) {
    const owner = await getUserByEmail(ctx.state.redis, body.email)
    if (owner && owner.id !== user.id) {
      fail(ctx, 409, '该邮箱已被其他账号使用', 409)
      return
    }
    user.email = body.email
  }
  user.profile = {
    ...user.profile,
    ...body,
  }
  await saveUser(ctx.state.redis, user)
  ok(ctx, { profile: user.profile })
})

router.patch('/language', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  const body = ctx.request.body as { locale?: string }
  if (body.locale && isAppLocale(body.locale)) user.locale = body.locale
  await saveUser(ctx.state.redis, user)
  ok(ctx, { locale: user.locale })
})

// ── 身份绑定：把登录方式挂到当前账号（命中他号 409）─────────────────────────
router.post('/bind/telegram', async (ctx) => {
  const body = ctx.request.body as Record<string, string>
  if (!body?.id || !body?.hash) { fail(ctx, 400, 'Invalid Telegram login payload'); return }
  try {
    const user = await bindTelegramWidget(ctx.state.redis, ctx.state.env, ctx.state.userId!, body)
    ok(ctx, { user: toPublicUser(user) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

router.post('/bind/telegram-oidc', async (ctx) => {
  const body = ctx.request.body as { code?: string; redirectUri?: string }
  if (!body.code || !body.redirectUri) { fail(ctx, 400, 'code and redirectUri are required'); return }
  try {
    const user = await bindTelegramOidc(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.code, body.redirectUri)
    ok(ctx, { user: toPublicUser(user) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

router.post('/bind/google', async (ctx) => {
  const body = ctx.request.body as { code?: string; redirectUri?: string }
  if (!body.code || !body.redirectUri) { fail(ctx, 400, 'code and redirectUri are required'); return }
  try {
    const user = await bindGoogleAccount(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.code, body.redirectUri)
    ok(ctx, { user: toPublicUser(user) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

router.post('/bind/phone', async (ctx) => {
  const body = ctx.request.body as { phone?: string; password?: string }
  if (!body.phone) { fail(ctx, 400, 'phone is required'); return }
  try {
    const user = await bindPhone(ctx.state.redis, ctx.state.userId!, body.phone, body.password)
    ok(ctx, { user: toPublicUser(user) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

router.post('/bind/account', async (ctx) => {
  const body = ctx.request.body as { username?: string; password?: string }
  if (!body.username || !body.password) { fail(ctx, 400, 'username and password are required'); return }
  try {
    const user = await bindAccount(ctx.state.redis, ctx.state.userId!, body.username, body.password)
    ok(ctx, { user: toPublicUser(user) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

export default router
