import Router from '@koa/router'
import {
  getDepositChannels,
  createDeposit,
  queryDeposit,
  getBankCodes,
  createWithdrawal,
  queryWithdrawal,
  YfPayError,
} from '../services/yfpay.service.js'
import { creditWallet, getWallet } from '../services/store/index.js'
import {
  savePaymentOrder,
  getPaymentOrderBySerial,
  listPaymentOrders,
} from '../services/store/payment-order-store.js'
import { isMysqlEnabled } from '../clients/mysql.client.js'
import { ok, fail } from '../utils/response.js'
import { randomOrderId } from '../utils/id.js'
import { nowIso } from '../utils/format.js'

const router = new Router()

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

    if (isMysqlEnabled(ctx.state.env)) {
      await savePaymentOrder(ctx.state.env, {
        userId: ctx.state.userId!,
        provider: 'yfpay',
        type: 'deposit',
        merchantSerial,
        platformId: result.platformId,
        amountCents: Math.round(amount * 100),
        channelCode,
        state: result.state,
        payUrl: result.url,
      })
    }

    ok(ctx, {
      merchantSerial,
      platformId: result.platformId,
      payUrl: result.url,
      amount,
      state: result.state,
    })
  } catch (err) {
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
  try {
    const result = await queryDeposit(body.merchantSerial, ctx.state.env)
    ok(ctx, result)
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
  const orders = await listPaymentOrders(ctx.state.env, ctx.state.userId!, 'deposit')
  ok(ctx, orders)
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

  if (!amount || amount <= 0 || !targetOwner || !targetAccount) {
    fail(ctx, 400, '缺少 amount / targetOwner / targetAccount')
    return
  }

  const amountCents = Math.round(amount * 100)
  const userId = ctx.state.userId!
  const redis = ctx.state.redis

  // 检查余额是否充足
  const wallet = await getWallet(redis, userId)
  if (wallet.available < amountCents) {
    fail(ctx, 400, '余额不足')
    return
  }

  const merchantSerial = randomOrderId('YFW')
  const notifyUrl = ctx.state.env.YFPAY_NOTIFY_URL

  try {
    // 先扣款（已成功创建订单才扣）
    const result = await createWithdrawal(
      { merchantSerial, amount, targetOwner, targetAccount, optionCode, notifyUrl },
      ctx.state.env,
    )

    // 扣除可用余额
    await creditWallet(redis, userId, -amountCents, {
      type: 'withdraw',
      refId: merchantSerial,
      description: `YF Pay 提现 #${merchantSerial}`,
      traceId: ctx.state.traceId,
      createdAt: nowIso(),
    })

    if (isMysqlEnabled(ctx.state.env)) {
      await savePaymentOrder(ctx.state.env, {
        userId,
        provider: 'yfpay',
        type: 'withdrawal',
        merchantSerial,
        platformId: result.platformId,
        amountCents,
        optionCode,
        targetAccount,
        targetOwner,
        state: result.state,
      })
    }

    ok(ctx, {
      merchantSerial,
      platformId: result.platformId,
      amount,
      state: result.state,
    })
  } catch (err) {
    const msg = err instanceof YfPayError ? err.message : '创建提现订单失败'
    fail(ctx, 500, msg)
  }
})

// POST /api/v1/withdraw/yfpay/query
router.post('/withdraw/yfpay/query', async (ctx) => {
  const body = ctx.request.body as { merchantSerial?: string }
  if (!body.merchantSerial) {
    fail(ctx, 400, '缺少 merchantSerial')
    return
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
  const orders = await listPaymentOrders(ctx.state.env, ctx.state.userId!, 'withdrawal')
  ok(ctx, orders)
})

export default router
