import Router from '@koa/router'
import { randomBytes } from 'node:crypto'
import { creditWallet, getKyc, getWallet, getWalletBalances, getWithdraw, listWithdrawals, saveWithdraw } from '../services/store.js'
import { createMatrixWithdraw } from '../services/matrix.service.js'
import { isMatrixEnabled } from '../clients/matrix.client.js'
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
  const body = ctx.request.body as {
    amount?: number
    currency?: string
    channelId?: string
    // Matrix 专属字段
    toAddress?: string
    symbol?: string
    chain?: string
    cryptoAmount?: string
  }

  // ── Matrix 提现 ─────────────────────────────────────────────────────────────
  if (body.channelId === 'matrix') {
    if (!isMatrixEnabled(ctx.state.env)) {
      fail(ctx, 503, 'Matrix payment channel is not configured', 503)
      return
    }
    const { toAddress, symbol, chain, cryptoAmount } = body
    if (!toAddress || !symbol || !chain || !cryptoAmount) {
      fail(ctx, 400, 'toAddress, symbol, chain, cryptoAmount are required for Matrix withdrawal')
      return
    }
    const cryptoAmt = Number(cryptoAmount)
    if (!Number.isFinite(cryptoAmt) || cryptoAmt <= 0) {
      fail(ctx, 400, 'Invalid cryptoAmount')
      return
    }

    const userId = ctx.state.userId!
    const redis = ctx.state.redis

    const lockKey = `withdraw:lock:${userId}`
    const lockVal = randomBytes(8).toString('hex')
    const locked = await redis.set(lockKey, lockVal, 'EX', 30, 'NX')
    if (!locked) {
      fail(ctx, 429, '请勿重复提交提现请求')
      return
    }

    try {
      // 检查对应虚拟币余额
      const currency = symbol.toUpperCase()
      const balances = await getWalletBalances(redis, userId)
      const cryptoBalance = balances.find((b) => b.currency === currency)?.available ?? 0
      if (cryptoAmt > cryptoBalance) {
        fail(ctx, 400, 'Insufficient balance')
        return
      }

      // 扣款（从对应虚拟币余额扣）
      const orderId = randomOrderId('WDR')
      await creditWallet(redis, userId, -cryptoAmt, {
        type: 'withdraw',
        refId: orderId,
        description: `Matrix ${symbol} 提现 #${orderId}`,
        createdAt: nowIso(),
        traceId: ctx.state.traceId,
        currency,
      })

      // 创建 Matrix 订单（失败会自动退款）
      const { merchantOrderNo, matrixOrderNo } = await createMatrixWithdraw(ctx.state.env, redis, {
        userId,
        toAddress,
        symbol: currency,
        chain: chain.toUpperCase(),
        cryptoAmount,
        phpAmount: cryptoAmt,
      })

      // createMatrixWithdraw 已写入 bg_withdraw_order（merchantOrderNo），无需再 saveWithdraw
      ok(ctx, { orderId: merchantOrderNo, status: 'pending', merchantOrderNo, matrixOrderNo })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Matrix withdrawal failed'
      fail(ctx, 502, msg, 502)
    } finally {
      const current = await redis.get(lockKey)
      if (current === lockVal) await redis.del(lockKey)
    }
    return
  }

  // ── tg_wallet 提现（原有逻辑）──────────────────────────────────────────────
  if (body.channelId !== 'tg_wallet' || body.currency !== 'PHP' || !body.amount) {
    fail(ctx, 400, 'Invalid withdrawal request')
    return
  }

  const userId = ctx.state.userId!
  const redis = ctx.state.redis

  // 分布式锁：防止并发提现导致 TOCTOU 竞态（多请求同时读到相同余额各自扣款）
  const lockKey = `withdraw:lock:${userId}`
  const lockVal = randomBytes(8).toString('hex')
  const locked = await redis.set(lockKey, lockVal, 'EX', 30, 'NX')
  if (!locked) {
    fail(ctx, 429, '请勿重复提交提现请求')
    return
  }

  try {
    const wallet = await getWallet(redis, userId)
    if (body.amount > wallet.available) {
      fail(ctx, 400, 'Insufficient balance')
      return
    }

    const orderId = randomOrderId('WDR')
    // creditWallet 原子扣款（Redis: Lua 脚本；MySQL: 事务），同时写入 ledger
    await creditWallet(redis, userId, -body.amount, {
      type: 'withdraw',
      refId: orderId,
      description: `提现 TG Wallet #${orderId}`,
      traceId: ctx.state.traceId,
      createdAt: nowIso(),
    })

    const order: WithdrawOrder = {
      orderId,
      userId,
      amount: body.amount,
      currency: 'PHP',
      channelId: 'tg_wallet',
      status: ctx.state.env.NODE_ENV !== 'production' ? 'completed' : 'pending',
      createdAt: nowIso(),
      completedAt: ctx.state.env.NODE_ENV !== 'production' ? nowIso() : undefined,
    }
    await saveWithdraw(redis, order)
    ok(ctx, { orderId: order.orderId, status: order.status })
  } finally {
    const current = await redis.get(lockKey)
    if (current === lockVal) await redis.del(lockKey)
  }
})

router.get('/', async (ctx) => {
  const page = Number(ctx.query.page ?? 1)
  const orders = await listWithdrawals(ctx.state.redis, ctx.state.userId!, page)
  ok(ctx, {
    items: orders.map((o) => ({
      orderId: o.orderId,
      amount: o.amount,
      currency: o.currency,
      channelId: o.channelId,
      status: o.status,
      createdAt: o.createdAt,
      completedAt: o.completedAt ?? null,
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
