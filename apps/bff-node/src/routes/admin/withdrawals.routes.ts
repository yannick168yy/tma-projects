import Router from '@koa/router'
import { listAdminWithdrawals, writeAuditLog } from '../../services/admin-store.js'
import { getWithdraw, saveWithdraw, creditWallet } from '../../services/store/index.js'
import { approveWithdraw } from '../../services/withdraw-approve.service.js'
import { getReviewLog } from '../../services/withdraw-review.service.js'
import { fail, ok } from '../../utils/response.js'
import { nowIso } from '../../utils/format.js'

const router = new Router({ prefix: '/withdrawals' })

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const userId = ctx.query.userId ? String(ctx.query.userId) : undefined
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  const reviewVerdict = ctx.query.reviewVerdict ? String(ctx.query.reviewVerdict) : undefined
  const result = await listAdminWithdrawals(ctx.state.env, { page, pageSize, userId, status, reviewVerdict })
  ok(ctx, result)
})

router.post('/:orderId/approve', async (ctx) => {
  const order = await getWithdraw(ctx.state.redis, ctx.params.orderId)
  if (!order) { fail(ctx, 404, 'Order not found', 404); return }
  if (order.status !== 'pending') {
    fail(ctx, 400, `Cannot approve order in status: ${order.status}`); return
  }

  try {
    const result = await approveWithdraw(ctx.state.env, ctx.state.redis, order)
    await writeAuditLog(ctx.state.env, {
      adminId: ctx.state.adminId!,
      adminUsername: ctx.state.adminUsername!,
      action: 'withdrawal.approve',
      targetType: 'withdrawal',
      targetId: order.orderId,
      detail: { userId: order.userId, amount: order.amount, currency: order.currency, matrixOrderNo: result.matrixOrderNo },
      ip: ctx.ip,
    })
    ok(ctx, { orderId: order.orderId, ...result })
  } catch (err) {
    // 出款失败（matrix）：executeMatrixWithdrawOrder 内部已退款并置 failed
    const msg = err instanceof Error ? err.message : 'Withdrawal approval failed'
    fail(ctx, 502, msg)
  }
})

// 单笔逐规则审核明细（前台行展开用）
router.get('/:orderId/review', async (ctx) => {
  const rules = await getReviewLog(ctx.state.env, ctx.params.orderId)
  ok(ctx, { rules })
})

router.post('/:orderId/reject', async (ctx) => {
  const body = ctx.request.body as { reason?: string }
  const order = await getWithdraw(ctx.state.redis, ctx.params.orderId)
  if (!order) { fail(ctx, 404, 'Order not found', 404); return }
  if (order.status !== 'pending') {
    fail(ctx, 400, `Cannot reject order in status: ${order.status}`); return
  }

  order.status = 'admin_rejected'
  order.rejectReason = body.reason ?? 'Rejected by admin'
  order.completedAt = nowIso()
  await saveWithdraw(ctx.state.redis, order)

  // 退款：退回原币种
  await creditWallet(
    ctx.state.redis,
    order.userId,
    order.amount,
    {
      type: 'withdraw',
      description: `Withdrawal rejected: ${body.reason ?? 'no reason'}`,
      traceId: ctx.state.traceId,
      refId: order.orderId,
      createdAt: nowIso(),
      currency: order.currency ?? 'PHP',
    },
  )

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'withdrawal.reject',
    targetType: 'withdrawal',
    targetId: order.orderId,
    detail: { userId: order.userId, amount: order.amount, currency: order.currency, reason: body.reason },
    ip: ctx.ip,
  })
  ok(ctx, { orderId: order.orderId, status: order.status })
})

export default router
