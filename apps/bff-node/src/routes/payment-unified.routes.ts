/**
 * 统一支付路由（用户侧）
 * 前端面向此接口，后端透明路由到 yfpay / unispay
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
  createDeposit as unispayCreateDeposit,
  queryDeposit as unispayQueryDeposit,
  UnispayError,
} from '../services/unispay.service.js'
import { syncQueriedDepositStatus } from '../services/deposit-status-sync.service.js'
import {
  getWalletBalances, getDeposit, getWithdraw, saveDeposit, saveWithdraw,
  creditWallet, listDeposits, listWithdrawals,
} from '../services/store/index.js'
import { isKycApproved } from '../services/kyc.service.js'
import { checkWithdrawPhoneAccount } from '../services/auth.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getWithdrawGate } from '../services/turnover.service.js'
import { reviewWithdraw } from '../services/withdraw-review.service.js'
import { hasRealDepositForWithdraw } from '../services/withdraw-eligibility.service.js'
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
  // 不用服务商接口覆盖，金额区间始终以后端渠道规则为准。
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
  const body = ctx.request.body as { channelName?: string; amount?: number; currency?: string }
  const channelName = String(body.channelName ?? '').toLowerCase().trim()
  const amount = Number(body.amount)
  const currency = String(body.currency ?? 'PHP').toUpperCase()

  if (!channelName || !Number.isFinite(amount) || amount <= 0) {
    fail(ctx, 400, '缺少 channelName 或 amount'); return
  }

  const provider = await resolveChannel(ctx.state.env, channelName, 'deposit', amount, currency)
  if (!provider) {
    fail(ctx, 400, 'errors.amountOrChannelUnavailable'); return
  }

  const merchantSerial = randomOrderId(provider === 'yfpay' ? 'YFD' : 'UPD')

  try {
    let payUrl: string
    let platformId: string
    let channelCodeUsed: string
    let qrcode: string | undefined

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
    } else if (provider === 'unispay') {
      if (currency !== 'IDR') { fail(ctx, 400, 'UnisPay 仅支持 IDR'); return }
      const result = await unispayCreateDeposit({
        amount,
        channelName,
        merchantSerial,
        notifyUrl: ctx.state.env.UNISPAY_NOTIFY_URL,
        returnUrl: ctx.state.env.UNISPAY_RETURN_URL,
      }, ctx.state.env)
      channelCodeUsed = channelName.toUpperCase()
      payUrl = result.payUrl
      qrcode = result.qrcode
      platformId = result.platformId
    } else {
      fail(ctx, 500, `未知 provider: ${provider}`); return
    }

    const order: OrderDeposit = {
      orderId: merchantSerial,
      userId: ctx.state.userId!,
      amount,
      currency: currency as OrderDeposit['currency'],
      channelId: `${provider}_${channelName}`,
      status: 'pending',
      provider,
      providerRef: platformId,
      extraData: { channelCode: channelCodeUsed, payUrl, qrcode, channelName },
      createdAt: nowIso(),
    }
    if (isMysqlEnabled(ctx.state.env)) {
      await saveDeposit(ctx.state.redis, order)
    }

    ok(ctx, { merchantSerial, platformId, payUrl, qrcode, amount, state: 0, provider })
  } catch (err) {
    console.error('[bff] payment/deposit/create', merchantSerial, err)
    const msg = err instanceof YfPayError ? err.message
      : err instanceof UnispayError ? err.message
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
    provider = order.provider ?? (order.channelId.startsWith('unispay_') ? 'unispay' : 'yfpay')
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
    } else if (provider === 'unispay') {
      const r = await unispayQueryDeposit(body.merchantSerial, ctx.state.env)
      state = r.state
    } else {
      const r = await yfpayQueryDeposit(body.merchantSerial, ctx.state.env)
      state = r.state
    }
    ok(ctx, { state })
  } catch (err) {
    const msg = err instanceof YfPayError ? err.message
      : err instanceof UnispayError ? err.message
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
    provider: o.provider ?? (o.channelId.startsWith('unispay_') ? 'unispay' : o.channelId.startsWith('yfpay_') ? 'yfpay' : undefined),
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
    currency?: string
  }
  const channelName = String(body.channelName ?? '').toLowerCase().trim()
  const { amount, targetOwner, targetAccount } = body
  const currency = String(body.currency ?? 'PHP').toUpperCase()

  if (!channelName || !amount || amount <= 0 || !targetOwner || !targetAccount) {
    fail(ctx, 400, '缺少必填字段'); return
  }

  const userId = ctx.state.userId!
  const redis = ctx.state.redis as Redis

  if (!(await isKycApproved(redis, ctx.state.env, userId))) {
    fail(ctx, 403, 'errors.kycRequired', 403); return
  }
  if (isMysqlEnabled(ctx.state.env) && !(await hasRealDepositForWithdraw(getMysqlPool(ctx.state.env), userId))) {
    fail(ctx, 403, 'errors.depositRequiredBeforeWithdraw', 403); return
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
    // 流水校验：存款 1 倍必须清零；未解锁彩金本金不可提
    let lockedBonus = 0
    if (isMysqlEnabled(ctx.state.env)) {
      const gate = await getWithdrawGate(getMysqlPool(ctx.state.env), userId, currency)
      if (!gate.ok) { fail(ctx, 403, 'errors.turnoverIncomplete'); return }
      lockedBonus = gate.lockedBonus
    }

    const wallet = (await getWalletBalances(redis, userId)).find((b) => b.currency === currency) ?? { available: 0, frozen: 0 }
    if (wallet.available < amount) { fail(ctx, 400, 'errors.insufficientBalance'); return }
    if (amount > wallet.available - lockedBonus) { fail(ctx, 403, 'errors.bonusLocked'); return }

    const provider = await resolveChannel(ctx.state.env, channelName, 'withdraw', amount, currency)
    if (!provider) { fail(ctx, 400, 'errors.amountOrChannelUnavailable'); return }
    if (provider === 'unispay' && (currency !== 'IDR' || !Number.isInteger(amount))) {
      fail(ctx, 400, 'UnisPay IDR 提现金额必须为整数'); return
    }

    // provider 专用渠道码：yfpay 代付使用 bank-codes 数字编码。
    const channelCode = channelName.toUpperCase()
    const optionCode = normalizeWithdrawOptionCode(channelCode)
    const merchantSerial = randomOrderId(provider === 'yfpay' ? 'YFW' : 'UPW')

    await creditWallet(redis, userId, -amount, {
      type: 'withdraw',
      refId: merchantSerial,
      description: `${provider} 提现 #${merchantSerial}`,
      traceId: ctx.state.traceId,
      createdAt: nowIso(),
      currency,
    })

    const wOrder: OrderWithdraw = {
      orderId: merchantSerial,
      userId,
      amount,
      currency,
      channelId: `${provider}_${channelName}`,
      status: 'pending',
      provider,
      extraData: {
        channelCode,
        optionCode: provider === 'yfpay' ? optionCode : undefined,
        channelName,
        targetAccount: targetAccount ?? '',
        targetOwner: targetOwner ?? '',
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
