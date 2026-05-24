import Router from '@koa/router'
import { getDeposit, listDeposits, saveDeposit } from '../services/store.js'
import { settlePaidDeposit, type DepositCurrency } from '../services/deposit.service.js'
import { createTelegramInvoiceLink, orderToTelegramInvoice } from '../services/telegramPayments.js'
import { nowIso } from '../utils/format.js'
import { fail, ok } from '../utils/response.js'
import { randomOrderId } from '../utils/id.js'
import type { DepositOrder } from '../types/domain.js'

const router = new Router({ prefix: '/deposits' })

function parseCurrency(raw?: string): DepositCurrency | null {
  if (raw === 'PHP' || raw === 'USDT') return raw
  return null
}

router.post('/', async (ctx) => {
  const body = ctx.request.body as { amount?: number; currency?: string; channelId?: string }
  if (body.channelId !== 'tg_wallet') {
    fail(ctx, 400, 'v0.1 only supports channelId=tg_wallet')
    return
  }
  const currency = parseCurrency(body.currency)
  if (!currency || !body.amount || body.amount <= 0) {
    fail(ctx, 400, 'Invalid amount or currency (PHP | USDT)')
    return
  }

  const orderId = randomOrderId('DEP')
  const order: DepositOrder = {
    orderId,
    userId: ctx.state.userId!,
    amount: body.amount,
    currency,
    channelId: 'tg_wallet',
    status: 'pending',
    createdAt: nowIso(),
    tgWalletParams: {
      provider: 'ammer_pay',
      currency,
      invoicePayload: orderId,
    },
  }
  await saveDeposit(ctx.state.redis, order)

  const providerToken = ctx.state.env.AMMER_PAY_PROVIDER_TOKEN?.trim()
  let invoiceLink: string | undefined

  if (providerToken) {
    try {
      const invoice = orderToTelegramInvoice(
        currency,
        body.amount,
        ctx.state.env.USDT_TO_PHP_RATE,
      )
      invoiceLink = await createTelegramInvoiceLink(
        ctx.state.env.TELEGRAM_BOT_TOKEN,
        providerToken,
        {
          title: 'BetoGo Deposit',
          description: `Deposit ${invoice.descriptionSuffix} via Telegram Wallet`,
          payload: orderId,
          currency: invoice.currency,
          amount: invoice.amount,
        },
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create payment invoice'
      fail(ctx, 502, message, 502)
      return
    }
  } else if (ctx.state.env.NODE_ENV !== 'production') {
    await settlePaidDeposit(ctx.state.redis, order, {
      traceId: ctx.state.traceId,
      usdtToPhpRate: ctx.state.env.USDT_TO_PHP_RATE,
      amountPhpUnits: body.amount,
      currency,
    })
    order.status = 'paid'
    await saveDeposit(ctx.state.redis, order)
  } else {
    fail(ctx, 503, 'Telegram payments are not configured (AMMER_PAY_PROVIDER_TOKEN)', 503)
    return
  }

  ok(ctx, {
    orderId: order.orderId,
    status: order.status,
    currency: order.currency,
    invoiceLink,
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
    paidAmount: order.status === 'paid' ? (order.creditedCents ?? 0) / 100 : 0,
  })
})

export default router
