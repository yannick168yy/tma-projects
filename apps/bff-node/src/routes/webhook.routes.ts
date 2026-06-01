import Router from '@koa/router'
import { getDeposit } from '../services/store/index.js'
import { depositAmountToYuan } from '../services/deposit.service.js'
import { ok } from '../utils/response.js'

const router = new Router({ prefix: '/webhooks' })

/**
 * Telegram Bot API webhook: handles successful_payment (Ammer Pay / TG Payments).
 * 验签后转发到 core-node /internal/payment/tg-wallet 处理入账，
 * BFF 自身不再直接 creditWallet。
 */
router.post('/telegram', async (ctx) => {
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

  // 折算入账金额
  const creditedCents = depositAmountToYuan(
    order.amount,
    order.currency,
    ctx.state.env.USDT_TO_PHP_RATE,
  )

  // 转发到 core-node 入账（core-node 负责账变）
  try {
    const coreUrl = `${ctx.state.env.CORE_NODE_URL}/internal/payment/tg-wallet`
    const res = await fetch(coreUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        orderId,
        userId: order.userId,
        amount: order.amount,
        creditedCents,
        currency: order.currency,
        description: `Telegram Wallet ${order.currency} deposit`,
      }),
    })
    if (!res.ok) {
      ctx.status = 502
      ctx.body = 'core-node payment failed'
      return
    }
  } catch {
    ctx.status = 502
    ctx.body = 'core-node unreachable'
    return
  }

  ok(ctx, { handled: true, orderId })
})

export default router
