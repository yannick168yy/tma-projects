import Router from '@koa/router'
import { creditWallet, getDeposit, getUser, listDeposits, saveDeposit, saveUser } from '../services/store.js'
import { nowIso } from '../utils/format.js'
import { fail, ok } from '../utils/response.js'
import { randomOrderId } from '../utils/id.js'
import type { DepositOrder } from '../types/domain.js'

const router = new Router({ prefix: '/deposits' })

router.post('/', async (ctx) => {
  const body = ctx.request.body as { amount?: number; currency?: string; channelId?: string }
  if (body.channelId !== 'tg_wallet') {
    fail(ctx, 400, 'v0.1 only supports channelId=tg_wallet')
    return
  }
  if (body.currency !== 'PHP' || !body.amount || body.amount <= 0) {
    fail(ctx, 400, 'Invalid amount or currency')
    return
  }

  const order: DepositOrder = {
    orderId: randomOrderId('DEP'),
    userId: ctx.state.userId!,
    amount: body.amount,
    currency: 'PHP',
    channelId: 'tg_wallet',
    status: 'pending',
    createdAt: nowIso(),
    tgWalletParams: {
      invoicePayload: `dep_${Date.now()}`,
      currency: 'PHP',
    },
  }
  await saveDeposit(ctx.state.redis, order)

  // Dev shortcut: auto-complete deposit after creation (until TG Wallet webhook)
  if (ctx.state.env.NODE_ENV !== 'production') {
    order.status = 'paid'
    order.paidAt = nowIso()
    await saveDeposit(ctx.state.redis, order)
    await creditWallet(ctx.state.redis, order.userId, order.amount, {
      type: 'deposit',
      refId: order.orderId,
      description: 'Telegram Wallet deposit',
      createdAt: nowIso(),
      traceId: ctx.state.traceId,
    })
    const user = await getUser(ctx.state.redis, order.userId)
    if (user && !user.firstDepReady && !user.firstDepClaimed) {
      user.firstDepReady = true
      await saveUser(ctx.state.redis, user)
    }
  }

  ok(ctx, {
    orderId: order.orderId,
    status: order.status,
    tgWalletParams: order.tgWalletParams,
  })
})

router.get('/', async (ctx) => {
  const page = Number(ctx.query.page ?? 1)
  const orders = await listDeposits(ctx.state.redis, ctx.state.userId!, page)
  ok(ctx, {
    items: orders.map((o) => ({
      orderId: o.orderId,
      amount: o.amount,
      currency: o.currency,
      status: o.status,
      createdAt: o.createdAt,
    })),
    page,
  })
})

router.get('/:orderId', async (ctx) => {
  const order = await getDeposit(ctx.state.redis, ctx.params.orderId)
  if (!order || order.userId !== ctx.state.userId) {
    fail(ctx, 404, 'Deposit not found', 404)
    return
  }
  ok(ctx, {
    orderId: order.orderId,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    paidAmount: order.status === 'paid' ? order.amount : 0,
  })
})

export default router
