import Router from '@koa/router'
import { getDeposit, saveDeposit } from '../services/store/index.js'
import { settlePaidDeposit } from '../services/deposit.service.js'
import { TON_PENDING_SET, TON_ORDER_TTL_MS } from '../services/ton.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { isCryptoChannelEnabled } from '../services/payment-channel.service.js'
import { nowIso } from '../utils/format.js'
import { fail, ok } from '../utils/response.js'
import { randomOrderId } from '../utils/id.js'
import type { DepositOrder } from '../types/domain.js'

const router = new Router({ prefix: '/deposits/ton' })

router.post('/', async (ctx) => {
  if (isMysqlEnabled(ctx.state.env) && !(await isCryptoChannelEnabled(ctx.state.env, 'ton'))) {
    fail(ctx, 403, 'errors.channelClosed'); return
  }
  const body = ctx.request.body as { amount?: number; walletAddress?: string }

  const amountTon = Number(body.amount)
  if (!Number.isFinite(amountTon) || amountTon < 0.01) {
    fail(ctx, 400, 'amount must be ≥ 0.01 TON')
    return
  }
  const walletAddress = body.walletAddress?.trim()
  if (!walletAddress) {
    fail(ctx, 400, 'walletAddress is required')
    return
  }

  const merchantAddress = ctx.state.env.MERCHANT_TON_ADDRESS
  if (!merchantAddress) {
    fail(ctx, 503, 'TON deposits not configured')
    return
  }

  const orderId = randomOrderId('TON')
  const amountNano = BigInt(Math.round(amountTon * 1e9)).toString()
  const expiresAt = (Date.now() + TON_ORDER_TTL_MS).toString()

  const order: DepositOrder = {
    orderId,
    userId: ctx.state.userId!,
    amount: amountTon,
    currency: 'TON',
    channelId: 'ton_connect',
    status: 'pending',
    createdAt: nowIso(),
    tonConnectParams: {
      userWalletAddress: walletAddress,
      amountNano,
      merchantAddress,
      expiresAt,
    },
  }

  await saveDeposit(ctx.state.redis, order)
  await ctx.state.redis.sadd(TON_PENDING_SET, orderId)

  // Dev mode: auto-settle without real blockchain
  if (ctx.state.env.NODE_ENV !== 'production' && !ctx.state.env.TONCENTER_API_KEY) {
    await settlePaidDeposit(ctx.state.redis, order, {
      traceId: ctx.state.traceId,
      usdtToPhpRate: ctx.state.env.USDT_TO_PHP_RATE,
      tonToPhpRate: ctx.state.env.TON_TO_PHP_RATE,
      amountPhpUnits: amountTon,
      currency: 'TON',
      mysqlPool: isMysqlEnabled(ctx.state.env) ? getMysqlPool(ctx.state.env) : undefined,
    })
    await ctx.state.redis.srem(TON_PENDING_SET, orderId)
    ok(ctx, {
      orderId,
      merchantAddress,
      amountNano,
      expiresAt,
      phpEquivalent: amountTon * ctx.state.env.TON_TO_PHP_RATE,
      devSettled: true,
    })
    return
  }

  ok(ctx, {
    orderId,
    merchantAddress,
    amountNano,
    expiresAt,
    phpEquivalent: amountTon * ctx.state.env.TON_TO_PHP_RATE,
  })
})

router.get('/:orderId/status', async (ctx) => {
  const order = await getDeposit(ctx.state.redis, ctx.params.orderId)
  if (!order || order.userId !== ctx.state.userId) {
    fail(ctx, 404, 'Order not found', 404)
    return
  }
  if (order.channelId !== 'ton_connect') {
    fail(ctx, 400, 'Not a TON Connect order')
    return
  }
  ok(ctx, {
    orderId: order.orderId,
    status: order.status,
    txHash: order.tonConnectParams?.txHash,
    creditedCents: order.status === 'paid' ? (order.creditedCents ?? 0) : 0,
  })
})

export default router
