import Router from '@koa/router'
import { getAdminById, setAdminTotpSecret, disableAdminTotp, writeAuditLog } from '../../services/admin-store.js'
import { clearTotpSetupRequired } from '../../services/admin-auth.service.js'
import { buildTotpUri, generateTotpSecret, verifyTotpCode } from '../../utils/totp.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/security' })
const TOTP_SETUP_TTL_SEC = 600

function setupKey(adminId: number): string {
  return `admin:totp:setup:${adminId}`
}

router.get('/totp/status', async (ctx) => {
  const admin = await getAdminById(ctx.state.env, ctx.state.adminId!)
  if (!admin) { fail(ctx, 404, 'Admin not found', 404); return }
  ok(ctx, {
    enabled: admin.totpEnabled,
    confirmedAt: admin.totpConfirmedAt ?? null,
  })
})

router.post('/totp/setup', async (ctx) => {
  const admin = await getAdminById(ctx.state.env, ctx.state.adminId!)
  if (!admin) { fail(ctx, 404, 'Admin not found', 404); return }
  const secret = generateTotpSecret()
  await ctx.state.redis.setex(setupKey(admin.id), TOTP_SETUP_TTL_SEC, secret)
  ok(ctx, {
    secret,
    otpauthUri: buildTotpUri({
      issuer: 'BetoGo Admin',
      account: admin.username,
      secret,
    }),
    expiresIn: TOTP_SETUP_TTL_SEC,
  })
})

router.post('/totp/enable', async (ctx) => {
  const body = ctx.request.body as { code?: string }
  if (!body.code) { fail(ctx, 400, 'code is required'); return }
  const admin = await getAdminById(ctx.state.env, ctx.state.adminId!)
  if (!admin) { fail(ctx, 404, 'Admin not found', 404); return }
  const secret = await ctx.state.redis.get(setupKey(admin.id))
  if (!secret) { fail(ctx, 400, 'Setup expired, please generate a new QR code'); return }
  if (!verifyTotpCode(secret, body.code)) {
    fail(ctx, 400, 'Invalid verification code')
    return
  }
  await setAdminTotpSecret(ctx.state.env, admin.id, secret)
  await ctx.state.redis.del(setupKey(admin.id))
  if (ctx.state.adminToken) await clearTotpSetupRequired(ctx.state.redis, ctx.state.adminToken)
  await writeAuditLog(ctx.state.env, {
    adminId: admin.id,
    adminUsername: admin.username,
    action: admin.totpEnabled ? 'admin.totp_reset' : 'admin.totp_enable',
    targetType: 'admin',
    targetId: String(admin.id),
    ip: ctx.ip,
  })
  ok(ctx, { enabled: true })
})

router.post('/totp/disable', async (ctx) => {
  const body = ctx.request.body as { code?: string }
  const admin = await getAdminById(ctx.state.env, ctx.state.adminId!)
  if (!admin) { fail(ctx, 404, 'Admin not found', 404); return }
  if (admin.totpEnabled && admin.totpSecret) {
    if (!body.code) { fail(ctx, 400, 'code is required'); return }
    if (!verifyTotpCode(admin.totpSecret, body.code)) {
      fail(ctx, 400, 'Invalid verification code')
      return
    }
  }
  await disableAdminTotp(ctx.state.env, admin.id)
  await ctx.state.redis.del(setupKey(admin.id))
  await writeAuditLog(ctx.state.env, {
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'admin.totp_disable',
    targetType: 'admin',
    targetId: String(admin.id),
    ip: ctx.ip,
  })
  ok(ctx, { enabled: false })
})

router.post('/totp/cancel-setup', async (ctx) => {
  await ctx.state.redis.del(setupKey(ctx.state.adminId!))
  ok(ctx, null)
})

export default router
