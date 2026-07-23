/**
 * 统一支付路由（用户侧）
 * 前端面向此接口，后端透明路由到 yfpay / beepay
 */
import Router from '@koa/router'
import { randomBytes } from 'node:crypto'
import { ok, fail } from '../utils/response.js'
import { randomOrderId } from '../utils/id.js'
import { nowIso } from '../utils/format.js'
import { resolveChannel, listAvailableChannels, listCryptoChannelStates } from '../services/payment-channel.service.js'
import {
  getDepositChannels as yfpayGetChannels,
  createDeposit as yfpayCreateDeposit,
  queryDeposit as yfpayQueryDeposit,
  YfPayError,
  normalizeWithdrawOptionCode,
} from '../services/yfpay.service.js'
import {
  createDeposit as beepayCreateDeposit,
  queryDeposit as beepayQueryDeposit,
  BeepayError,
} from '../services/beepay.service.js'
import { syncQueriedDepositStatus } from '../services/deposit-status-sync.service.js'
import {
  getWallet, getDeposit, getWithdraw, saveDeposit, saveWithdraw,
  creditWallet, listDeposits, listWithdrawals,
} from '../services/store/index.js'
import { isKycApproved } from '../services/kyc.service.js'
import { checkWithdrawPhoneAccount } from '../services/auth.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { canWithdraw as checkTurnover } from '../services/turnover.service.js'
import { reviewWithdraw } from '../services/withdraw-review.service.js'
import type { OrderDeposit, OrderWithdraw } from '../types/domain.js'
import type { Redis } from 'ioredis'
import type { TxType } from '../services/payment-channel.service.js'

const router = new Router()

// 收款账号=手机号的电子钱包渠道（GoTyme 是银行卡号，不在此列）
const PHONE_WALLET_WITHDRAW_CHANNELS = new Set(['gcash', 'maya'])

function depositOrderState(status: OrderDeposit['status']): number {
  if (status === 'paid') return 2
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 3
  return 0
}

// yfpay 渠道列表 Redis 缓存（5 分钟）
async function getCachedYfpayChannels(redis: Redis, env: Parameters<typeof yfpayGetChannels>[0]) {
  const KEY = 'payment:yfpay:channels:cache'
  const cached = await redis.get(KEY)
  if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof yfpayGetChannels>>
  const channels = await yfpayGetChannels(env)
  await redis.setex(KEY, 300, JSON.stringify(channels))
  return channels
}

// 根据渠道名找 yfpay channel code（GCASH-001 等）
function findYfpayCode(channels: Awaited<ReturnType<typeof yfpayGetChannels>>, channelName: string) {
  return channels.find(
    (c) => c.code.toUpperCase().startsWith(channelName.toUpperCase()) ||
           c.name.toLowerCase().includes(channelName.toLowerCase())
  )
}

// 可用渠道列表 Redis 缓存（60 秒）。实际下单路由走 resolveChannel 不读此缓存，
// 故后台改渠道后真实路由立即生效，仅客户端展示列表最多滞后 60 秒。
async function getCachedAvailableChannels(redis: Redis, env: Parameters<typeof listAvailableChannels>[0], txType: TxType, currency: string) {
  const KEY = `payment:channels:${txType}:${currency}`
  const cached = await redis.get(KEY)
  if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof listAvailableChannels>>
  const channels = await listAvailableChannels(env, txType, currency)
  await redis.setex(KEY, 60, JSON.stringify(channels))
  return channels
}

// ── GET /payment/channels ─────────────────────────────────────────────────────

router.get('/payment/channels', async (ctx) => {
  const txType = (ctx.query.txType ?? 'deposit') as TxType
  const currency = String(ctx.query.currency ?? 'PHP').toUpperCase()

  // min/max 以后台配置的规则区间为准（listAvailableChannels 已聚合 MIN/MAX），
  // 不再用 yfpay 接口覆盖——否则同名 yfpay 渠道会把 beepay 渠道的配置区间冲掉
  const channels = await getCachedAvailableChannels(ctx.state.redis as Redis, ctx.state.env, txType, currency)
  ok(ctx, channels)
})

// ── GET /payment/crypto-channels ───────────────────────────────────────────────
// 虚拟币 / TG 渠道开关状态（客户端按开关展示，灰显被关渠道）

router.get('/payment/crypto-channels', async (ctx) => {
  ok(ctx, await listCryptoChannelStates(ctx.state.env))
})

// ── POST /payment/deposit/create ──────────────────────────────────────────────

router.post('/payment/deposit/create', async (ctx) => {
  const body = ctx.request.body as { channelName?: string; amount?: number }
  const channelName = String(body.channelName ?? '').toLowerCase().trim()
  const amount = Number(body.amount)

  if (!channelName || !Number.isFinite(amount) || amount <= 0) {
    fail(ctx, 400, '缺少 channelName 或 amount'); return
  }

  const provider = await resolveChannel(ctx.state.env, channelName, 'deposit', amount, 'PHP')
  if (!provider) {
    fail(ctx, 400, 'errors.amountOrChannelUnavailable'); return
  }

  const merchantSerial = randomOrderId(provider === 'yfpay' ? 'YFD' : 'BPD')

  try {
    let payUrl: string
    let platformId: string
    let channelCodeUsed: string

    if (provider === 'yfpay') {
      const yfChannels = await getCachedYfpayChannels(ctx.state.redis as Redis, ctx.state.env)
      const yf = findYfpayCode(yfChannels, channelName)
      if (!yf) { fail(ctx, 400, `yfpay 暂无 ${channelName} 渠道`); return }
      channelCodeUsed = yf.code
      const result = await yfpayCreateDeposit({
        amount, channelCode: yf.code, merchantSerial,
        notifyUrl: ctx.state.env.YFPAY_NOTIFY_URL,
      }, ctx.state.env)
      payUrl = result.url
      platformId = result.platformId
    } else if (provider === 'beepay') {
      channelCodeUsed = channelName.toUpperCase()
      const result = await beepayCreateDeposit({
        amount, channelCode: channelCodeUsed, merchantSerial,
        notifyUrl: ctx.state.env.BEEPAY_NOTIFY_URL,
      }, ctx.state.env)
      payUrl = result.payUrl
      platformId = result.platformId
    } else {
      fail(ctx, 500, `未知 provider: ${provider}`); return
    }

    const order: OrderDeposit = {
      orderId: merchantSerial,
      userId: ctx.state.userId!,
      amount,
      currency: 'PHP',
      channelId: `${provider}_${channelName}`,
      status: 'pending',
      provider,
      providerRef: platformId,
      extraData: { channelCode: channelCodeUsed, payUrl, channelName },
      createdAt: nowIso(),
    }
    if (isMysqlEnabled(ctx.state.env)) {
      await saveDeposit(ctx.state.redis, order)
    }

    ok(ctx, { merchantSerial, platformId, payUrl, amount, state: 0, provider })
  } catch (err) {
    console.error('[bff] payment/deposit/create', merchantSerial, err)
    const msg = err instanceof YfPayError ? err.message
      : err instanceof BeepayError ? err.message
      : '创建充值订单失败'
    fail(ctx, 500, msg)
  }
})

// ── POST /payment/deposit/query ───────────────────────────────────────────────

router.post('/payment/deposit/query', async (ctx) => {
  const body = ctx.request.body as { merchantSerial?: string }
  if (!body.merchantSerial) { fail(ctx, 400, '缺少 merchantSerial'); return }

  let provider = 'yfpay'
  let order: OrderDeposit | null = null
  if (isMysqlEnabled(ctx.state.env)) {
    order = await getDeposit(ctx.state.redis, body.merchantSerial)
    if (!order || order.userId !== ctx.state.userId) { fail(ctx, 403, 'errors.noPermission'); return }
    provider = order.provider ?? (order.channelId.startsWith('beepay_') ? 'beepay' : 'yfpay')
    if (order.status !== 'pending') {
      ok(ctx, { state: depositOrderState(order.status) })
      return
    }
  }

  try {
    let state: number
    if (order) {
      const synced = await syncQueriedDepositStatus(ctx.state.env, order)
      state = synced?.state ?? depositOrderState(order.status)
    } else if (provider === 'beepay') {
      const r = await beepayQueryDeposit(body.merchantSerial, ctx.state.env)
      state = r.state
    } else {
      const r = await yfpayQueryDeposit(body.merchantSerial, ctx.state.env)
      state = r.state
    }
    ok(ctx, { state })
  } catch (err) {
    const msg = err instanceof YfPayError ? err.message
      : err instanceof BeepayError ? err.message
      : '查询失败'
    fail(ctx, 500, msg)
  }
})

// ── GET /payment/deposit/orders ───────────────────────────────────────────────

router.get('/payment/deposit/orders', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, []); return }
  const orders = await listDeposits(ctx.state.redis, ctx.state.userId!, 1, 50)
  ok(ctx, orders.map((o) => ({
    merchantSerial: o.orderId,
    amount: o.amount,
    channelName: (o.extraData as Record<string, string> | undefined)?.channelName ?? o.channelId,
    provider: o.provider ?? (o.channelId.startsWith('beepay_') ? 'beepay' : o.channelId.startsWith('yfpay_') ? 'yfpay' : undefined),
    state: depositOrderState(o.status),
    payUrl: (o.extraData as Record<string, string> | undefined)?.payUrl,
    createdAt: o.createdAt,
  })))
})

// ── POST /payment/withdraw/create ─────────────────────────────────────────────

router.post('/payment/withdraw/create', async (ctx) => {
  const body = ctx.request.body as {
    channelName?: string; amount?: number
    targetOwner?: string; targetAccount?: string
  }
  const channelName = String(body.channelName ?? '').toLowerCase().trim()
  const { amount, targetOwner, targetAccount } = body

  if (!channelName || !amount || amount <= 0 || !targetOwner || !targetAccount) {
    fail(ctx, 400, '缺少必填字段'); return
  }

  const userId = ctx.state.userId!
  const redis = ctx.state.redis as Redis

  if (!(await isKycApproved(redis, ctx.state.env, userId))) {
    fail(ctx, 403, 'errors.kycRequired', 403); return
  }

  // 手机钱包（GCash/Maya）收款号必须归属本人：拦截取到他人手机号，首次取款绑定并锁定
  if (PHONE_WALLET_WITHDRAW_CHANNELS.has(channelName)) {
    const phoneCheck = await checkWithdrawPhoneAccount(redis, userId, targetAccount)
    if (!phoneCheck.ok) { fail(ctx, phoneCheck.status, phoneCheck.error); return }
  }

  const lockKey = `withdraw:lock:${userId}`
  const lockVal = randomBytes(8).toString('hex')
  const locked = await redis.set(lockKey, lockVal, 'EX', 30, 'NX')
  if (!locked) { fail(ctx, 429, 'errors.duplicateWithdraw'); return }

  try {
    if (isMysqlEnabled(ctx.state.env)) {
      const turnoverOk = await checkTurnover(getMysqlPool(ctx.state.env), userId, 'PHP')
      if (!turnoverOk) { fail(ctx, 403, 'errors.turnoverIncomplete'); return }
    }

    const wallet = await getWallet(redis, userId)
    if (wallet.available < amount) { fail(ctx, 400, 'errors.insufficientBalance'); return }

    const provider = await resolveChannel(ctx.state.env, channelName, 'withdraw', amount, 'PHP')
    if (!provider) { fail(ctx, 400, 'errors.amountOrChannelUnavailable'); return }

    // provider 专用渠道码：yfpay 代付使用 bank-codes 数字编码，beepay 待文档确认
    const channelCode = channelName.toUpperCase()
    const optionCode = normalizeWithdrawOptionCode(channelCode)
    const merchantSerial = randomOrderId(provider === 'yfpay' ? 'YFW' : 'BPW')

    await creditWallet(redis, userId, -amount, {
      type: 'withdraw',
      refId: merchantSerial,
      description: `${provider} 提现 #${merchantSerial}`,
      traceId: ctx.state.traceId,
      createdAt: nowIso(),
    })

    const wOrder: OrderWithdraw = {
      orderId: merchantSerial,
      userId,
      amount,
      currency: 'PHP',
      channelId: `${provider}_${channelName}`,
      status: 'pending',
      provider,
      extraData: {
        channelCode,
        optionCode: provider === 'yfpay' ? optionCode : undefined,
        channelName,
        targetAccount: targetAccount ?? '',
        targetOwner: targetOwner ?? '',
        // BeePay 文档到手后补充其他字段
      },
      createdAt: nowIso(),
    }
    await saveWithdraw(redis, wOrder)
    await reviewWithdraw(ctx.state.env, redis, merchantSerial)

    const finalOrder = await getWithdraw(redis, merchantSerial)
    ok(ctx, {
      merchantSerial,
      amount,
      status: finalOrder?.status ?? 'pending',
      platformId: (finalOrder?.extraData as Record<string, unknown> | undefined)?.platformId ?? null,
    })
  } finally {
    const current = await redis.get(lockKey)
    if (current === lockVal) await redis.del(lockKey)
  }
})

// ── GET /payment/withdraw/orders ──────────────────────────────────────────────

router.get('/payment/withdraw/orders', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, []); return }
  const orders = await listWithdrawals(ctx.state.redis, ctx.state.userId!, 1, 50)
  ok(ctx, orders.map((o) => ({
    merchantSerial: o.orderId,
    amount: o.amount,
    channelName: (o.extraData as Record<string, string> | undefined)?.channelName ?? o.channelId,
    provider: o.provider,
    state: o.status === 'completed' ? 1 : o.status === 'rejected' ? 2 : 0,
    createdAt: o.createdAt,
  })))
})

export default router
