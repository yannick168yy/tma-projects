import Router from '@koa/router'
import { getDeposit, listDeposits, saveDeposit } from '../services/store.js'
import { settlePaidDeposit, type DepositCurrency } from '../services/deposit.service.js'
import { createTelegramInvoiceLink, orderToTelegramInvoice } from '../services/telegramPayments.js'
import { getOrFetchDepositAddress } from '../services/matrix.service.js'
import { isMatrixEnabled } from '../clients/matrix.client.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { isCryptoChannelEnabled } from '../services/payment-channel.service.js'
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
  if (isMysqlEnabled(ctx.state.env) && !(await isCryptoChannelEnabled(ctx.state.env, `tg_wallet_${currency.toLowerCase()}`))) {
    fail(ctx, 403, '该渠道已关闭'); return
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
        ctx.state.env.AMMER_PAY_PHP_PER_STAR,
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
      mysqlPool: isMysqlEnabled(ctx.state.env) ? getMysqlPool(ctx.state.env) : undefined,
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
      channelId: o.channelId,
      status: o.status,
      creditedCents: o.creditedCents ?? null,
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
    paidAmount: order.status === 'paid' ? (order.creditedCents ?? 0) : 0,
  })
})

// ── Matrix 充值地址 ───────────────────────────────────────────────────────────
// GET /deposits/matrix/address?symbol=USDT&chain=TRON
router.get('/matrix/address', async (ctx) => {
  if (!isMatrixEnabled(ctx.state.env)) {
    fail(ctx, 503, 'Matrix payment channel is not configured', 503)
    return
  }

  const symbol = String(ctx.query.symbol ?? '').toUpperCase()
  const chain = String(ctx.query.chain ?? '').toUpperCase()
  if (!symbol || !chain) {
    fail(ctx, 400, 'symbol and chain are required')
    return
  }
  if (isMysqlEnabled(ctx.state.env) && !(await isCryptoChannelEnabled(ctx.state.env, `matrix_${symbol.toLowerCase()}`))) {
    fail(ctx, 403, '该渠道已关闭'); return
  }

  try {
    const result = await getOrFetchDepositAddress(ctx.state.env, ctx.state.userId!, symbol, chain)
    ok(ctx, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to get deposit address'
    fail(ctx, 502, msg, 502)
  }
})

export default router
