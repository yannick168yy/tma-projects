import Router from '@koa/router'
import { settlePaidDeposit } from '../services/deposit.service.js'
import { getDeposit } from '../services/store/index.js'
import { ok } from '../utils/response.js'
import type { DepositCurrency } from '../services/deposit.service.js'

const router = new Router({ prefix: '/webhooks' })

/**
 * Telegram Bot API webhook: handles successful_payment (Ammer Pay / TG Payments).
 * Configure: setWebhook → https://www.188facai.com/api/v1/webhooks/telegram
 */
router.post('/telegram', async (ctx) => {
  const update = ctx.request.body as {
    message?: {
      successful_payment?: {
        currency: string
        total_amount: number
        invoice_payload: string
      }
    }
  }

  const payment = update.message?.successful_payment
  if (!payment) {
    ok(ctx, { handled: false })
    return
  }

  const orderId = payment.invoice_payload
  const order = await getDeposit(ctx.state.redis, orderId)
  if (!order) {
    ctx.status = 404
    ctx.body = { code: 404, message: 'Deposit order not found', data: null }
    return
  }

  if (order.status === 'paid') {
    ok(ctx, { handled: true, orderId, duplicate: true })
    return
  }

  const currency: DepositCurrency = payment.currency === 'USDT' ? 'USDT' : 'PHP'
  const amountPhpUnits = currency === 'PHP' ? payment.total_amount / 100 : payment.total_amount

  await settlePaidDeposit(ctx.state.redis, order, {
    traceId: ctx.state.traceId,
    usdtToPhpRate: ctx.state.env.USDT_TO_PHP_RATE,
    amountPhpUnits,
    currency,
  })

  ok(ctx, { handled: true, orderId })
})

export default router
