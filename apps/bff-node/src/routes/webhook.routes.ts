import Router from '@koa/router'
import { settlePaidDeposit } from '../services/deposit.service.js'
import { getDeposit } from '../services/store/index.js'
import { ok } from '../utils/response.js'
const router = new Router({ prefix: '/webhooks' })

/**
 * Telegram Bot API webhook: handles successful_payment (Ammer Pay / TG Payments).
 * Configure: setWebhook → https://www.188facai.com/api/v1/webhooks/telegram
 *   需同时设置 secret_token 参数（对应 TELEGRAM_WEBHOOK_SECRET 环境变量），
 *   Telegram 会在每次回调的 X-Telegram-Bot-Api-Secret-Token header 中携带该值。
 */
router.post('/telegram', async (ctx) => {
  // 验证 secret token，防止任意方伪造充值回调
  const secret = ctx.state.env.TELEGRAM_WEBHOOK_SECRET
  if (secret) {
    const provided = ctx.get('X-Telegram-Bot-Api-Secret-Token')
    if (provided !== secret) {
      ctx.status = 403
      ctx.body = 'forbidden'
      return
    }
  }

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

  // Invoice is always PHP on Telegram; credit wallet per original order (PHP or USDT).
  await settlePaidDeposit(ctx.state.redis, order, {
    traceId: ctx.state.traceId,
    usdtToPhpRate: ctx.state.env.USDT_TO_PHP_RATE,
    amountPhpUnits: order.amount,
    currency: order.currency,
  })

  ok(ctx, { handled: true, orderId })
})

export default router
