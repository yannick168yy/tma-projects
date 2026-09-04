import Router from '@koa/router'
import {
  changeAdminPassword, createImpersonationSession, loginAdmin, logoutAdmin, verifyAdminTotpLogin,
} from '../../services/admin-auth.service.js'
import { consumeImpersonateTicket } from '../../services/impersonate.service.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { getAdminById, writeAuditLog } from '../../services/admin-store.js'
import type { RowDataPacket } from 'mysql2/promise'
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

/**
 * 兑换 impersonate 票据（P1-6）。跑在**租户后台域名**上，所以此处已有租户上下文。
 *
 * 不挂 adminAuthMiddleware：这条接口本身就是用来拿会话的。
 */
router.post('/impersonate', async (ctx) => {
  const ticket = String((ctx.request.body as { ticket?: unknown })?.ticket ?? '')
  const payload = await consumeImpersonateTicket(ctx.state.env, ticket)
  // 票据无效 / 已用过 / 已过期，一律同一句话：区分开来等于告诉试探者票据格式对不对
  if (!payload) { fail(ctx, 401, '票据无效或已过期', 401); return }

  // 🔴 最关键的一处：票据必须与当前域名所属租户一致。
  // 不校验的话，拿到 A 租户的票就能在 B 租户的后台域名兑换出 B 的超管会话。
  const tenant = ctx.state.tenant
  if (!tenant || tenant.id !== payload.tenantId) {
    fail(ctx, 401, '票据无效或已过期', 401); return
  }
  if (!isMysqlEnabled(ctx.state.env)) { fail(ctx, 503, '存储不可用', 503); return }

  // 绑到该租户真实的 super_admin：审计表 admin_id 无外键，
  // 但填一个不存在的 id 会让「按管理员查审计」永远查不到这些记录
  const [rows] = await getMysqlPool(ctx.state.env).query<RowDataPacket[]>(
    "SELECT id FROM admin_accounts WHERE role = 'super_admin' AND status = 'active' ORDER BY id LIMIT 1")
  const accountId = rows[0] ? Number(rows[0].id) : null
  if (accountId === null) { fail(ctx, 400, '该租户没有可用的超级管理员账号'); return }
  const account = await getAdminById(ctx.state.env, accountId)
  if (!account) { fail(ctx, 400, '该租户没有可用的超级管理员账号'); return }

  const session = await createImpersonationSession(ctx.state.redis, account, payload.platformUsername)
  // 审计写进**租户自己的**库：客户查自己的操作日志时必须能看到平台方进来过
  await writeAuditLog(ctx.state.env, {
    adminId: account.id,
    adminUsername: session.username,
    action: 'admin_impersonate_login',
    targetType: 'admin',
    targetId: String(account.id),
    detail: { platformUsername: payload.platformUsername, platformAdminId: payload.platformAdminId },
    ip: ctx.ip,
  })
  ok(ctx, { token: session.token, role: session.role, username: session.username, expiresIn: session.expiresIn })
})
