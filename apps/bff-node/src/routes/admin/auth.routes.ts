import Router from '@koa/router'
import { loginAdmin, logoutAdmin, changeAdminPassword, verifyAdminTotpLogin } from '../../services/admin-auth.service.js'
import { adminAuthMiddleware } from '../../middleware/admin-auth.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/auth' })

function cleanIp(raw: string): string {
  return raw.replace(/^::ffff:/i, '')
}

router.post('/login', async (ctx) => {
  const body = ctx.request.body as { username?: string; password?: string }
  if (!body.username || !body.password) {
    fail(ctx, 400, 'username and password required')
    return
  }
  const username = body.username.trim().toLowerCase()
  const ip = cleanIp(ctx.ip)
  const failureKey = `admin:login:fails:${ip}:${username}`
  const lockKey = `admin:login:lock:${ip}:${username}`
  if (await ctx.state.redis.get(lockKey)) {
    fail(ctx, 429, 'errors.tooManyAttempts', 429)
    return
  }
  const result = await loginAdmin(ctx.state.redis, ctx.state.env, body.username, body.password)
  if (!result) {
    const failed = await ctx.state.redis.incr(failureKey)
    if (failed === 1) await ctx.state.redis.expire(failureKey, 900)
    if (failed >= 5) {
      await ctx.state.redis.set(lockKey, '1', 'EX', 900)
      await ctx.state.redis.del(failureKey)
      fail(ctx, 429, 'errors.tooManyAttempts', 429)
      return
    }
    fail(ctx, 401, 'Invalid credentials', 401)
    return
  }
  await ctx.state.redis.del(failureKey, lockKey)
  ok(ctx, result)
})

router.post('/login/totp', async (ctx) => {
  const body = ctx.request.body as { challengeToken?: string; code?: string }
  if (!body.challengeToken || !body.code) {
    fail(ctx, 400, 'challengeToken and code required')
    return
  }
  const result = await verifyAdminTotpLogin(ctx.state.redis, ctx.state.env, body.challengeToken, body.code)
  if (!result) {
    fail(ctx, 401, 'Invalid verification code', 401)
    return
  }
  ok(ctx, result)
})

router.post('/logout', async (ctx) => {
  const auth = ctx.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    await logoutAdmin(ctx.state.redis, auth.slice(7))
  }
  ok(ctx, null)
})

router.post('/change-password', adminAuthMiddleware(), async (ctx) => {
  const body = ctx.request.body as { currentPassword?: string; newPassword?: string }
  if (!body.currentPassword || !body.newPassword) {
    fail(ctx, 400, 'currentPassword and newPassword required'); return
  }
  if (body.newPassword.length < 8) {
    fail(ctx, 400, 'newPassword must be at least 8 characters'); return
  }
  const result = await changeAdminPassword(
    ctx.state.env,
    ctx.state.adminId!,
    body.currentPassword,
    body.newPassword,
  )
  if (result === 'wrong_password') { fail(ctx, 400, '当前密码错误'); return }
  if (result === 'not_found') { fail(ctx, 404, 'Admin not found', 404); return }
  ok(ctx, null)
})

export default router
