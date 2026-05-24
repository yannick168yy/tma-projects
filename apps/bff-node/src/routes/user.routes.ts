import Router from '@koa/router'
import { getUser, saveUser } from '../services/store.js'
import { isAppLocale } from '../types/locale.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/user' })

router.get('/me', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  ok(ctx, {
    id: user.id,
    telegramUserId: user.telegramUserId,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    inviteCode: user.inviteCode,
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

export default router
