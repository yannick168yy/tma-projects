import Router from '@koa/router'
import { listAdminUsers, writeAuditLog } from '../../services/admin-store.js'
import { getUser, saveUser, getWallet, creditWallet, listLedger } from '../../services/store/index.js'
import { fail, ok } from '../../utils/response.js'
import { nowIso } from '../../utils/format.js'

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
  const wallet = await getWallet(ctx.state.redis, ctx.params.id)
  const ledger = await listLedger(ctx.state.redis, ctx.params.id, 20)
  ok(ctx, { user, wallet, ledger })
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
  const body = ctx.request.body as { cents?: number; note?: string }
  if (typeof body.cents !== 'number' || body.cents === 0) {
    fail(ctx, 400, 'cents must be a non-zero number'); return
  }
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }

  const wallet = await creditWallet(
    ctx.state.redis,
    ctx.params.id,
    body.cents,
    {
      type: 'bonus',
      description: body.note ?? `Admin adjustment by ${ctx.state.adminUsername}`,
      traceId: ctx.state.traceId,
      refId: undefined,
      createdAt: nowIso(),
    },
  )
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.balance_adjust',
    targetType: 'user',
    targetId: user.id,
    detail: { cents: body.cents, note: body.note, balanceAfterCents: wallet.available },
    ip: ctx.ip,
  })
  ok(ctx, { available: wallet.available })
})

export default router
