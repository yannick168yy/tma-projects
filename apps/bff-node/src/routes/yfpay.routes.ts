import Router from '@koa/router'
import { randomBytes } from 'node:crypto'
import {
  getDepositChannels,
  createDeposit,
  queryDeposit,
  getBankCodes,
  queryWithdrawal,
  YfPayError,
  normalizeWithdrawOptionCode,
} from '../services/yfpay.service.js'
import { creditWallet, getWallet, getDeposit, getWithdraw, saveDeposit, saveWithdraw, listDeposits, listWithdrawals } from '../services/store/index.js'
import { syncQueriedDepositStatus } from '../services/deposit-status-sync.service.js'
import { reviewWithdraw } from '../services/withdraw-review.service.js'
import { isKycApproved } from '../services/kyc.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getWithdrawGate } from '../services/turnover.service.js'
import { ok, fail } from '../utils/response.js'
import { randomOrderId } from '../utils/id.js'
import { nowIso } from '../utils/format.js'
import type { OrderDeposit, OrderWithdraw } from '../types/domain.js'

const router = new Router()

function depositOrderState(status: OrderDeposit['status']): number {
  if (status === 'paid') return 2
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 3
  return 0
}

// ── 代收 ──────────────────────────────────────────────────────────────────

// GET /api/v1/deposit/yfpay/channels
router.get('/deposit/yfpay/channels', async (ctx) => {
  try {
    const channels = await getDepositChannels(ctx.state.env)
    ok(ctx, channels)
  } catch (err) {
    const msg = err instanceof YfPayError ? err.message : '获取通道失败'
    fail(ctx, 500, msg)
  }
})

// POST /api/v1/deposit/yfpay/create
router.post('/deposit/yfpay/create', async (ctx) => {
  const body = ctx.request.body as { amount?: number; channelCode?: string }
  const { amount, channelCode } = body

  if (!amount || amount <= 0 || !channelCode) {
    fail(ctx, 400, '缺少 amount 或 channelCode')
    return
  }

  const merchantSerial = randomOrderId('YFD')
  const notifyUrl = ctx.state.env.YFPAY_NOTIFY_URL

  try {
    const result = await createDeposit(
      { amount, channelCode, merchantSerial, notifyUrl },
      ctx.state.env,
    )

    const order: OrderDeposit = {
      orderId: merchantSerial,
      userId: ctx.state.userId!,
      amount,                                     // PHP 元（浮点），供对账展示用
      currency: 'PHP',
      channelId: `yfpay_${channelCode.split('-')[0].toLowerCase()}`,
      status: 'pending',
      provider: 'yfpay',
      providerRef: result.platformId,
      extraData: { channelCode, payUrl: result.url, state: result.state },
      createdAt: nowIso(),
    }
    if (isMysqlEnabled(ctx.state.env)) {
      await saveDeposit(ctx.state.redis, order)
    }

    ok(ctx, {
      merchantSerial,
      platformId: result.platformId,
      payUrl: result.url,
      amount,
      state: result.state,
    })
  } catch (err) {
    console.error('[bff] deposit/yfpay/create', merchantSerial, err)
    const msg = err instanceof YfPayError ? err.message : '创建充值订单失败'
    fail(ctx, 500, msg)
  }
})

// POST /api/v1/deposit/yfpay/query
router.post('/deposit/yfpay/query', async (ctx) => {
  const body = ctx.request.body as { merchantSerial?: string }
  if (!body.merchantSerial) {
    fail(ctx, 400, '缺少 merchantSerial')
    return
  }
  // 归属权校验（MySQL 模式下）
  let order: OrderDeposit | null = null
  if (isMysqlEnabled(ctx.state.env)) {
    order = await getDeposit(ctx.state.redis, body.merchantSerial)
    if (!order || order.userId !== ctx.state.userId) {
      fail(ctx, 403, 'errors.noPermission')
      return
    }
    if (order.status !== 'pending') {
      ok(ctx, { state: depositOrderState(order.status) })
      return
    }
  }
  try {
    if (order) {
      const synced = await syncQueriedDepositStatus(ctx.state.env, order)
      ok(ctx, { state: synced?.state ?? depositOrderState(order.status) })
      return
    }
    ok(ctx, await queryDeposit(body.merchantSerial, ctx.state.env))
  } catch (err) {
    const msg = err instanceof YfPayError ? err.message : '查询失败'
    fail(ctx, 500, msg)
  }
})

// GET /api/v1/deposit/yfpay/orders  (当前用户充值记录)
router.get('/deposit/yfpay/orders', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, [])
    return
  }
  const orders = await listDeposits(ctx.state.redis, ctx.state.userId!, 1, 50)
  const yfOrders = orders.filter((o) => (o.provider ?? o.channelId).startsWith('yfpay'))
  ok(ctx, yfOrders.map((o) => ({
    merchantSerial: o.orderId,
    amount: o.amount,
    state: depositOrderState(o.status),
    channelCode: (o.extraData as Record<string, string> | undefined)?.channelCode,
    payUrl: (o.extraData as Record<string, string> | undefined)?.payUrl,
    createdAt: o.createdAt,
  })))
})

// ── 代付 ──────────────────────────────────────────────────────────────────

// GET /api/v1/withdraw/yfpay/banks
router.get('/withdraw/yfpay/banks', async (ctx) => {
  try {
    const banks = await getBankCodes(ctx.state.env)
    ok(ctx, banks)
  } catch (err) {
    const msg = err instanceof YfPayError ? err.message : '获取银行列表失败'
    fail(ctx, 500, msg)
  }
})

// POST /api/v1/withdraw/yfpay/create
router.post('/withdraw/yfpay/create', async (ctx) => {
  const body = ctx.request.body as {
    amount?: number
    targetOwner?: string
    targetAccount?: string
    optionCode?: string
    bankName?: string
  }
  const { amount, targetOwner, targetAccount, optionCode } = body
  const providerOptionCode = optionCode ? normalizeWithdrawOptionCode(optionCode) : ''

  if (!amount || amount <= 0 || !targetOwner || !targetAccount) {
    fail(ctx, 400, '缺少 amount / targetOwner / targetAccount')
    return
  }

  const userId = ctx.state.userId!
  const redis = ctx.state.redis

  // KYC 硬闸门：未实名禁止提款
  if (!(await isKycApproved(redis, ctx.state.env, userId))) {
    fail(ctx, 403, 'errors.kycRequired', 403)
    return
  }

  // 分布式锁：防止并发提现（TOCTOU）
  const lockKey = `withdraw:lock:${userId}`
  const lockVal = randomBytes(8).toString('hex')
  const locked = await redis.set(lockKey, lockVal, 'EX', 30, 'NX')
  if (!locked) {
    fail(ctx, 429, 'errors.duplicateWithdraw')
    return
  }

  try {
    // 流水校验：存款 1 倍必须清零；未解锁彩金本金不可提
    let lockedBonus = 0
    if (isMysqlEnabled(ctx.state.env)) {
      const gate = await getWithdrawGate(getMysqlPool(ctx.state.env), userId, 'PHP')
      if (!gate.ok) {
        fail(ctx, 403, 'errors.turnoverIncomplete')
        return
      }
      lockedBonus = gate.lockedBonus
    }

    // 检查余额是否充足
    const wallet = await getWallet(redis, userId)
    if (wallet.available < amount) {
      fail(ctx, 400, 'errors.insufficientBalance')
      return
    }
    if (amount > wallet.available - lockedBonus) {
      fail(ctx, 403, 'errors.bonusLocked')
      return
    }

    const merchantSerial = randomOrderId('YFW')

    // 先扣余额（原子写入，防止多笔并发双花）
    await creditWallet(redis, userId, -amount, {
      type: 'withdraw',
      refId: merchantSerial,
      description: `YF Pay 提现 #${merchantSerial}`,
      traceId: ctx.state.traceId,
      createdAt: nowIso(),
    })

    // 建单 pending，不在此处调 YF Pay API；出款延迟到审核通过/人工批准时（approveWithdraw）
    const wOrder: OrderWithdraw = {
      orderId: merchantSerial,
      userId,
      amount,
      currency: 'PHP',
      channelId: `yfpay_${(optionCode ?? 'unknown').toLowerCase()}`,
      status: 'pending',
      provider: 'yfpay',
      extraData: { optionCode: providerOptionCode, channelCode: optionCode ?? '', targetAccount: targetAccount ?? '', targetOwner: targetOwner ?? '' },
      createdAt: nowIso(),
    }
    await saveWithdraw(ctx.state.redis, wOrder)

    // 自动审核：全部规则通过则 approveWithdraw 调 YF Pay 出款，否则留 pending 转人工
    await reviewWithdraw(ctx.state.env, redis, merchantSerial)

    const finalOrder = await getWithdraw(ctx.state.redis, merchantSerial)
    ok(ctx, {
      merchantSerial,
      amount,
      status: finalOrder?.status ?? 'pending',
      platformId: (finalOrder?.extraData as Record<string, unknown> | undefined)?.platformId ?? null,
    })
  } finally {
    // 释放锁（仅当仍是当前持有者）
    const current = await redis.get(lockKey)
    if (current === lockVal) await redis.del(lockKey)
  }
})

// POST /api/v1/withdraw/yfpay/query
router.post('/withdraw/yfpay/query', async (ctx) => {
  const body = ctx.request.body as { merchantSerial?: string }
  if (!body.merchantSerial) {
    fail(ctx, 400, '缺少 merchantSerial')
    return
  }
  // 归属权校验（MySQL 模式下）
  if (isMysqlEnabled(ctx.state.env)) {
    const order = await getWithdraw(ctx.state.redis, body.merchantSerial)
    if (!order || order.userId !== ctx.state.userId) {
      fail(ctx, 403, 'errors.noPermission')
      return
    }
  }
  try {
    const result = await queryWithdrawal(body.merchantSerial, ctx.state.env)
    ok(ctx, result)
  } catch (err) {
    const msg = err instanceof YfPayError ? err.message : '查询失败'
    fail(ctx, 500, msg)
  }
})

// GET /api/v1/withdraw/yfpay/orders  (当前用户提现记录)
router.get('/withdraw/yfpay/orders', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, [])
    return
  }
  const orders = await listWithdrawals(ctx.state.redis, ctx.state.userId!, 1, 50)
  const yfOrders = orders.filter((o) => o.provider === 'yfpay')
  ok(ctx, yfOrders.map((o) => ({
    merchantSerial: o.orderId,
    amount: o.amount,
    state: o.status === 'completed' ? 1 : o.status === 'rejected' ? 2 : 0,
    optionCode: (o.extraData as Record<string, string> | undefined)?.optionCode,
    createdAt: o.createdAt,
  })))
})

export default router
