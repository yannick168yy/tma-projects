import Router from '@koa/router'
import { loginAdmin, logoutAdmin } from '../../services/admin-auth.service.js'
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

export default router
