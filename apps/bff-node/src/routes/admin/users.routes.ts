import Router from '@koa/router'
import { listAdminUsers, writeAuditLog, updateUserLabel, getLoginLogs, getBetOrders, getOpPasswordHash } from '../../services/admin-store.js'
import { getUser, saveUser, getWallet, listLedger, adminAdjustBalance } from '../../services/store/index.js'
import { verifyPassword } from '../../services/admin-auth.service.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/users' })

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const search = ctx.query.search ? String(ctx.query.search) : undefined
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  const result = await listAdminUsers(ctx.state.env, { page, pageSize, search, status })
  ok(ctx, result)
})

router.get('/:id', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }
  const [wallet, ledger, loginLogs, betOrders] = await Promise.all([
    getWallet(ctx.state.redis, ctx.params.id),
    listLedger(ctx.state.redis, ctx.params.id, 20),
    getLoginLogs(ctx.state.env, ctx.params.id, 20),
    getBetOrders(ctx.state.env, ctx.params.id, 30),
  ])
  ok(ctx, { user, wallet, ledger, loginLogs, betOrders })
})

router.patch('/:id/status', async (ctx) => {
  const body = ctx.request.body as { status?: string; reason?: string }
  const allowed = ['active', 'frozen', 'banned']
  if (!body.status || !allowed.includes(body.status)) {
    fail(ctx, 400, 'status must be active | frozen | banned'); return
  }
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }

  const prev = user.status
  user.status = body.status as typeof user.status
  user.statusReason = body.reason ?? undefined
  await saveUser(ctx.state.redis, user)

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.status_change',
    targetType: 'user',
    targetId: user.id,
    detail: { from: prev, to: body.status, reason: body.reason },
    ip: ctx.ip,
  })
  ok(ctx, { status: user.status })
})

router.post('/:id/adjust-balance', async (ctx) => {
  const body = ctx.request.body as { cents?: number; note?: string; opPassword?: string }
  if (typeof body.cents !== 'number' || body.cents === 0) {
    fail(ctx, 400, 'cents must be a non-zero number'); return
  }
  if (!body.opPassword) {
    fail(ctx, 400, 'opPassword is required'); return
  }

  // 验证操作密码
  const opHash = await getOpPasswordHash(ctx.state.env)
  if (!opHash) {
    fail(ctx, 403, 'Operation password not configured. Please ask super_admin to set it first.'); return
  }
  const valid = await verifyPassword(body.opPassword, opHash)
  if (!valid) {
    fail(ctx, 403, 'Incorrect operation password'); return
  }

  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }

  let result: { available: number; orderId: string }
  try {
    result = await adminAdjustBalance(
      ctx.state.redis,
      ctx.params.id,
      body.cents,
      {
        adminUsername: ctx.state.adminUsername!,
        note: body.note,
        traceId: ctx.state.traceId,
      },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Adjustment failed'
    fail(ctx, 400, msg); return
  }

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.balance_adjust',
    targetType: 'user',
    targetId: user.id,
    detail: { cents: body.cents, note: body.note, orderId: result.orderId, balanceAfterCents: result.available },
    ip: ctx.ip,
  })
  ok(ctx, { available: result.available, orderId: result.orderId })
})

router.patch('/:id/profile', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }
  const body = ctx.request.body as Partial<typeof user.profile>
  const prev = { ...user.profile }
  user.profile = { ...user.profile, ...body }
  await saveUser(ctx.state.redis, user)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.profile_edit',
    targetType: 'user',
    targetId: user.id,
    detail: { before: prev, after: user.profile },
    ip: ctx.ip,
  })
  ok(ctx, { profile: user.profile })
})

router.patch('/:id/label', async (ctx) => {
  const body = ctx.request.body as { label?: string }
  const allowed = ['normal', 'arbitrage']
  if (!body.label || !allowed.includes(body.label)) {
    fail(ctx, 400, 'label must be normal | arbitrage'); return
  }
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }
  await updateUserLabel(ctx.state.env, ctx.params.id, body.label)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.label_change',
    targetType: 'user',
    targetId: ctx.params.id,
    detail: { label: body.label },
    ip: ctx.ip,
  })
  ok(ctx, { label: body.label })
})

export default router
