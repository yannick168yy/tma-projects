import Router from '@koa/router'
import { randomBytes } from 'node:crypto'
import { creditWallet, getKyc, getWallet, getWalletBalances, getWithdraw, listWithdrawals, saveWithdraw } from '../services/store.js'
import { generateMerchantOrderNo, initMatrixWithdrawOrder } from '../services/matrix.service.js'
import { isMatrixEnabled } from '../clients/matrix.client.js'
import { getCryptoWithdrawGate, resolveCryptoWithdrawGasFee } from '../services/payment-channel.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { nowIso } from '../utils/format.js'
import { fail, ok } from '../utils/response.js'
import { randomOrderId } from '../utils/id.js'
import { getWithdrawGate } from '../services/turnover.service.js'
import { reviewWithdraw } from '../services/withdraw-review.service.js'
import { isKycApproved } from '../services/kyc.service.js'
import { riskAllowed } from '../utils/risk-guard.js'
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

  const userId = ctx.state.userId!
  const [wallet, kyc] = await Promise.all([
    getWallet(ctx.state.redis, userId),
    getKyc(ctx.state.redis, userId),
  ])
  const kycApproved = kyc?.status === 'approved'
  const gate = isMysqlEnabled(ctx.state.env)
    ? await getWithdrawGate(getMysqlPool(ctx.state.env), userId, currency)
    : { ok: true, depositRemaining: 0, lockedBonus: 0 }
  const withdrawable = Math.max(0, wallet.available - gate.lockedBonus)

  ok(ctx, {
    currency,
    channelId,
    amount,
    eligible: kycApproved && gate.ok && amount > 0 && amount <= withdrawable,
    kycApproved,
    turnoverOk: gate.ok,
    available: wallet.available,
    lockedBonus: gate.lockedBonus,
    withdrawable,
    fee: 0,
    minAmount: 10000,
    maxAmount: withdrawable,
    rejectReasons: [
      !kycApproved ? 'KYC not approved' : null,
      !gate.ok ? 'Turnover requirement not met' : null,
      amount > withdrawable ? 'Insufficient balance' : null,
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

  // 风控前置：deny 直接拒；escalate 只落日志放行，由审核引擎的 risk_hit 规则读日志转人工
  if (!(await riskAllowed(ctx, 'withdraw'))) return

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
    // 输入金额是钱包实扣总额，gas 从中扣除，链上到账为 cryptoAmt - gasFee。
    let gasFee = 0
    if (isMysqlEnabled(ctx.state.env)) {
      const gate = await getCryptoWithdrawGate(ctx.state.env, `matrix_${symbol.toLowerCase()}_w`)
      if (!gate.enabled) { fail(ctx, 403, 'errors.channelClosed'); return }
      gasFee = resolveCryptoWithdrawGasFee(gate, cryptoAmt)
    }
    const payoutAmount = cryptoAmt - gasFee
    if (payoutAmount <= 0) {
      fail(ctx, 400, 'errors.withdrawAmountMustExceedGas')
      return
    }
    const totalDebit = cryptoAmt

    const userId = ctx.state.userId!
    const redis = ctx.state.redis

    // KYC 硬闸门：未实名禁止提款
    if (!(await isKycApproved(redis, ctx.state.env, userId))) {
      fail(ctx, 403, 'errors.kycRequired', 403)
      return
    }

    const lockKey = `withdraw:lock:${userId}`
    const lockVal = randomBytes(8).toString('hex')
    const locked = await redis.set(lockKey, lockVal, 'EX', 30, 'NX')
    if (!locked) {
      fail(ctx, 429, 'errors.duplicateWithdraw')
      return
    }

    try {
      const currency = symbol.toUpperCase()

      // 流水校验：存款 1 倍必须清零；未解锁彩金本金不可提（可提额 = 余额 - lockedBonus）
      let lockedBonus = 0
      if (isMysqlEnabled(ctx.state.env)) {
        const gate = await getWithdrawGate(getMysqlPool(ctx.state.env), userId, currency)
        if (!gate.ok) {
          fail(ctx, 403, 'errors.turnoverIncomplete')
          return
        }
        lockedBonus = gate.lockedBonus
      }

      // 检查对应虚拟币余额
      const balances = await getWalletBalances(redis, userId)
      const cryptoBalance = balances.find((b) => b.currency === currency)?.available ?? 0
      if (totalDebit > cryptoBalance) {
        fail(ctx, 400, 'Insufficient balance')
        return
      }
      if (totalDebit > cryptoBalance - lockedBonus) {
        fail(ctx, 403, 'errors.bonusLocked')
        return
      }

      const merchantOrderNo = generateMerchantOrderNo()
      const gasNote = gasFee > 0 ? `（gas ${gasFee}，到账 ${payoutAmount}）` : ''

      // 先扣用户输入的取款总额，等后台审批后按扣除 gas 后的金额打款。
      await creditWallet(redis, userId, -totalDebit, {
        type: 'withdraw',
        refId: merchantOrderNo,
        description: `Matrix ${symbol} 提现 #${merchantOrderNo}${gasNote}`,
        createdAt: nowIso(),
        traceId: ctx.state.traceId,
        currency,
      })

      // 存单，不调 Matrix API，等后台审批。amount=实扣总额供退款；extra.cryptoAmount=链上到账额。
      try {
        await initMatrixWithdrawOrder(ctx.state.env, {
          merchantOrderNo,
          userId,
          toAddress,
          symbol: currency,
          chain: chain.toUpperCase(),
          payoutAmount: String(payoutAmount),
          gasFee,
        })
      } catch (dbErr) {
        // DB 失败：退款（退回实扣总额）
        await creditWallet(redis, userId, totalDebit, {
          type: 'deposit',
          refId: merchantOrderNo,
          description: `Matrix 提现申请创建失败退款 #${merchantOrderNo}`,
          createdAt: nowIso(),
          currency,
        })
        throw dbErr
      }

      // 自动审核：全部规则通过则自动批准出款，否则留 pending 转人工
      await reviewWithdraw(ctx.state.env, redis, merchantOrderNo)

      ok(ctx, { orderId: merchantOrderNo, status: 'pending' })
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

  // KYC 硬闸门：未实名禁止提款
  if (!(await isKycApproved(redis, ctx.state.env, userId))) {
    fail(ctx, 403, 'errors.kycRequired', 403)
    return
  }

  // 分布式锁：防止并发提现导致 TOCTOU 竞态（多请求同时读到相同余额各自扣款）
  const lockKey = `withdraw:lock:${userId}`
  const lockVal = randomBytes(8).toString('hex')
  const locked = await redis.set(lockKey, lockVal, 'EX', 30, 'NX')
  if (!locked) {
    fail(ctx, 429, 'errors.duplicateWithdraw')
    return
  }

  try {
    // 流水校验：存款 1 倍必须清零；未解锁彩金本金不可提（可提额 = 余额 - lockedBonus）
    let lockedBonus = 0
    if (isMysqlEnabled(ctx.state.env)) {
      const gate = await getWithdrawGate(getMysqlPool(ctx.state.env), userId, 'PHP')
      if (!gate.ok) {
        fail(ctx, 403, 'errors.turnoverIncomplete')
        return
      }
      lockedBonus = gate.lockedBonus
    }

    const wallet = await getWallet(redis, userId)
    if (body.amount > wallet.available) {
      fail(ctx, 400, 'Insufficient balance')
      return
    }
    if (body.amount > wallet.available - lockedBonus) {
      fail(ctx, 403, 'errors.bonusLocked')
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
      status: 'pending',
      createdAt: nowIso(),
    }
    await saveWithdraw(redis, order)

    // 自动审核：全部规则通过则自动批准出款，否则留 pending 转人工
    await reviewWithdraw(ctx.state.env, redis, order.orderId)

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
