import Router from '@koa/router'
import { getDeposit } from '../services/store/index.js'
import { depositAmountToYuan } from '../services/deposit.service.js'
import { answerPreCheckoutQuery } from '../services/telegramPayments.js'
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
    pre_checkout_query?: {
      id: string
      invoice_payload: string
    }
  }

  // Telegram 支付两段式：先 pre_checkout_query，必须 10s 内应答 ok=true 才会真正扣款。
  // 仅当 invoice_payload 对应一笔 pending 存款单时放行，否则拒绝。
  const preCheckout = update.pre_checkout_query
  if (preCheckout) {
    const order = await getDeposit(ctx.state.redis, preCheckout.invoice_payload)
    const approve = !!order && order.status === 'pending'
    await answerPreCheckoutQuery(ctx.state.env.TELEGRAM_BOT_TOKEN, preCheckout.id, approve)
    ok(ctx, { handled: approve, preCheckout: true })
    return
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

// YFPay 代收回调唯一入口是 core-node /api/v1/callback/yfpay（nginx 直达，NATS 消费）。
// 此处原有的 /webhooks/yfpay 平行遗留路径已删除，避免双路径配置漂移。

// Viber 强制要求 Public Account 先 set_webhook 才允许调发帖 API(否则报 status 10 webhookNotSet)。
// 社区营销只发不收,此端点仅应答 200 让 Viber 的 webhook 校验通过,收到的事件一律忽略。
router.post('/viber', (ctx) => {
  ctx.status = 200
  ctx.body = { status: 0, status_message: 'ok' }
})

export default router
