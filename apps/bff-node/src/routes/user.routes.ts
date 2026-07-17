import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getUser, listUserIdentities, saveUser } from '../services/store.js'
import { toPublicUser } from '../services/userPresentation.js'
import { AuthError, bindGoogleAccount, bindPhone, bindTelegramOidc, bindTelegramWidget } from '../services/auth.service.js'
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
  const [[agent]] = await getMysqlPool(ctx.state.env).query<RowDataPacket[]>(
    `SELECT 1 FROM bg_agent WHERE agent_id = ? AND status = 'active'`,
    [user.id],
  )
  ok(ctx, {
    ...toPublicUser(user, await listUserIdentities(ctx.state.redis, user.id)),
    registeredAt: user.registeredAt,
    locale: user.locale,
    isAgent: Boolean(agent),
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
    ok(ctx, { user: toPublicUser(user, await listUserIdentities(ctx.state.redis, user.id)) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

router.post('/bind/telegram-oidc', async (ctx) => {
  const body = ctx.request.body as { code?: string; redirectUri?: string }
  if (!body.code || !body.redirectUri) { fail(ctx, 400, 'code and redirectUri are required'); return }
  try {
    const user = await bindTelegramOidc(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.code, body.redirectUri)
    ok(ctx, { user: toPublicUser(user, await listUserIdentities(ctx.state.redis, user.id)) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

router.post('/bind/google', async (ctx) => {
  const body = ctx.request.body as { code?: string; redirectUri?: string }
  if (!body.code || !body.redirectUri) { fail(ctx, 400, 'code and redirectUri are required'); return }
  try {
    const user = await bindGoogleAccount(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.code, body.redirectUri)
    ok(ctx, { user: toPublicUser(user, await listUserIdentities(ctx.state.redis, user.id)) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

router.post('/bind/phone', async (ctx) => {
  const body = ctx.request.body as { phone?: string; password?: string }
  if (!body.phone) { fail(ctx, 400, 'phone is required'); return }
  if (!body.password) { fail(ctx, 400, 'password is required'); return }
  try {
    const user = await bindPhone(ctx.state.redis, ctx.state.userId!, body.phone, body.password)
    ok(ctx, { user: toPublicUser(user, await listUserIdentities(ctx.state.redis, user.id)) })
  } catch (e) { if (!handleBindError(ctx, e)) throw e }
})

export default router
