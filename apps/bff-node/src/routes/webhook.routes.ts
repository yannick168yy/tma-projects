import Router from '@koa/router'
import { getDeposit } from '../services/store/index.js'
import { depositAmountToYuan } from '../services/deposit.service.js'
import { verifySign } from '../services/yfpay.service.js'
import { ok, fail } from '../utils/response.js'

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

// POST /webhooks/yfpay  — YFPay 代收回调（支付成功通知）
router.post('/yfpay', async (ctx) => {
  const body = ctx.request.body as Record<string, unknown>

  // 验签（防伪造）
  if (!verifySign(body, ctx.state.env.YFPAY_API_KEY)) {
    ctx.status = 403
    ctx.body = 'invalid sign'
    return
  }

  // state=2 表示支付成功
  const state = Number(body['state'] ?? 0)
  if (state !== 2) {
    ok(ctx, { handled: false, reason: 'not paid' })
    return
  }

  const merchantSerial = String(body['merchantSerial'] ?? '')
  const creditedCents  = Math.round(Number(body['amount'] ?? 0) * 100) / 100  // PHP 元，保留两位小数

  if (!merchantSerial || creditedCents <= 0) {
    fail(ctx, 400, 'missing merchantSerial or amount')
    return
  }

  // 查订单所属用户（归属权 + 幂等检查）
  const order = await getDeposit(ctx.state.redis, merchantSerial)
  if (!order) {
    ctx.status = 404
    ctx.body = { code: 404, message: 'order not found' }
    return
  }
  if (order.status === 'paid') {
    ok(ctx, { handled: true, orderId: merchantSerial, duplicate: true })
    return
  }

  // 转发到 core-node 入账（core-node 负责账变 + 激活）
  try {
    const coreUrl = `${ctx.state.env.CORE_NODE_URL}/internal/payment/yfpay`
    const res = await fetch(coreUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        orderId: merchantSerial,
        userId: order.userId,
        creditedCents,
      }),
    })
    if (!res.ok) {
      ctx.status = 502
      ctx.body = 'core-node yfpay payment failed'
      return
    }
  } catch {
    ctx.status = 502
    ctx.body = 'core-node unreachable'
    return
  }

  ok(ctx, { handled: true, orderId: merchantSerial })
})

export default router
