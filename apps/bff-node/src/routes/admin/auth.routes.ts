import Router from '@koa/router'
import { loginAdmin, logoutAdmin, changeAdminPassword } from '../../services/admin-auth.service.js'
import { adminAuthMiddleware } from '../../middleware/admin-auth.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/auth' })

router.post('/login', async (ctx) => {
  const body = ctx.request.body as { username?: string; password?: string }
  if (!body.username || !body.password) {
    fail(ctx, 400, 'username and password required')
    return
  }
  const result = await loginAdmin(ctx.state.redis, ctx.state.env, body.username, body.password)
  if (!result) {
    fail(ctx, 401, 'Invalid credentials', 401)
    return
  }
  ok(ctx, { token: result.token, expiresIn: result.expiresIn, role: result.role })
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
