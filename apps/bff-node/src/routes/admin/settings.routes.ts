import Router from '@koa/router'
import { getOpPasswordHash, setOpPassword } from '../../services/admin-store.js'
import { hashPassword, verifyPassword } from '../../services/admin-auth.service.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/settings' })

// 查询操作密码是否已设置（所有管理员均可查）
router.get('/op-password', async (ctx) => {
  const hash = await getOpPasswordHash(ctx.state.env)
  ok(ctx, { configured: hash !== null })
})

// 设置/修改操作密码（仅 super_admin）
router.post('/op-password', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') {
    fail(ctx, 403, 'Only super_admin can manage the operation password'); return
  }

  const body = ctx.request.body as { newPassword?: string; currentPassword?: string }
  if (!body.newPassword || body.newPassword.length < 6) {
    fail(ctx, 400, 'newPassword must be at least 6 characters'); return
  }

  const existing = await getOpPasswordHash(ctx.state.env)
  if (existing) {
    // 已设置过，需验证旧密码
    if (!body.currentPassword) {
      fail(ctx, 400, 'currentPassword is required to change existing op password'); return
    }
    const valid = await verifyPassword(body.currentPassword, existing)
    if (!valid) {
      fail(ctx, 400, 'currentPassword is incorrect'); return
    }
  }

  const newHash = await hashPassword(body.newPassword)
  await setOpPassword(ctx.state.env, newHash)
  ok(ctx, null)
})

export default router
