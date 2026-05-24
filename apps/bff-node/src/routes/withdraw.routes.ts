import Router from '@koa/router'
import { getKyc, getWallet, getWithdraw, listWithdrawals, saveWallet, saveWithdraw } from '../services/store.js'
import { nowIso } from '../utils/format.js'
import { fail, ok } from '../utils/response.js'
import { randomOrderId } from '../utils/id.js'
import type { WithdrawOrder } from '../types/domain.js'

const router = new Router({ prefix: '/withdrawals' })

router.get('/eligibility', async (ctx) => {
  const currency = String(ctx.query.currency ?? 'PHP')
  const channelId = String(ctx.query.channelId ?? '')
  const amount = Number(ctx.query.amount ?? 0)
  if (channelId !== 'tg_wallet') {
    fail(ctx, 400, 'v0.1 only supports channelId=tg_wallet')
    return
  }

  const wallet = await getWallet(ctx.state.redis, ctx.state.userId!)
  const kyc = await getKyc(ctx.state.redis, ctx.state.userId!)
  const kycApproved = kyc?.status === 'approved'

  const multiplier = 3
  const requiredTurnover = wallet.available * multiplier
  const completedTurnover = Math.min(requiredTurnover, wallet.available)
  const turnoverOk = completedTurnover >= requiredTurnover || wallet.available === 0

  ok(ctx, {
    currency,
    channelId,
    amount,
    eligible: kycApproved && turnoverOk && amount > 0 && amount <= wallet.available,
    kycApproved,
    turnoverOk,
    available: wallet.available,
    fee: 0,
    minAmount: 10000,
    maxAmount: wallet.available,
    rejectReasons: [
      !kycApproved ? 'KYC not approved' : null,
      !turnoverOk ? 'Turnover requirement not met' : null,
      amount > wallet.available ? 'Insufficient balance' : null,
    ].filter(Boolean),
  })
})

router.post('/', async (ctx) => {
  const body = ctx.request.body as { amount?: number; currency?: string; channelId?: string }
  if (body.channelId !== 'tg_wallet' || body.currency !== 'PHP' || !body.amount) {
    fail(ctx, 400, 'Invalid withdrawal request')
    return
  }

  const wallet = await getWallet(ctx.state.redis, ctx.state.userId!)
  if (body.amount > wallet.available) {
    fail(ctx, 400, 'Insufficient balance')
    return
  }

  wallet.available -= body.amount
  await saveWallet(ctx.state.redis, ctx.state.userId!, wallet)

  const order: WithdrawOrder = {
    orderId: randomOrderId('WDR'),
    userId: ctx.state.userId!,
    amount: body.amount,
    currency: 'PHP',
    channelId: 'tg_wallet',
    status: ctx.state.env.NODE_ENV !== 'production' ? 'completed' : 'pending',
    createdAt: nowIso(),
    completedAt: ctx.state.env.NODE_ENV !== 'production' ? nowIso() : undefined,
  }
  await saveWithdraw(ctx.state.redis, order)
  ok(ctx, { orderId: order.orderId, status: order.status })
})

router.get('/', async (ctx) => {
  const page = Number(ctx.query.page ?? 1)
  const orders = await listWithdrawals(ctx.state.redis, ctx.state.userId!, page)
  ok(ctx, {
    items: orders.map((o) => ({
      orderId: o.orderId,
      amount: o.amount,
      status: o.status,
      createdAt: o.createdAt,
    })),
    page,
  })
})

router.get('/:orderId', async (ctx) => {
  const order = await getWithdraw(ctx.state.redis, ctx.params.orderId)
  if (!order || order.userId !== ctx.state.userId) {
    fail(ctx, 404, 'Withdrawal not found', 404)
    return
  }
  ok(ctx, {
    orderId: order.orderId,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
    rejectReason: order.rejectReason,
  })
})

export default router
