import type { Redis } from 'ioredis'
import type { DepositOrder } from '../types/domain.js'
import { REFERRAL_MIN_DEPOSIT_CENTS } from '../constants/referral.js'
import {
  creditWallet,
  getDeposit,
  getUser,
  listDeposits,
  saveDeposit,
  saveUser,
} from './store.js'
import { nowIso, phpToCents } from '../utils/format.js'

export type DepositCurrency = 'PHP' | 'USDT'

export function depositAmountToCents(
  amount: number,
  currency: DepositCurrency,
  usdtToPhpRate: number,
): number {
  if (currency === 'PHP') return phpToCents(amount)
  if (amount <= 0 || usdtToPhpRate <= 0) return 0
  return phpToCents(amount * usdtToPhpRate)
}

async function countPaidDeposits(redis: Redis, userId: string, excludeOrderId?: string): Promise<number> {
  const orders = await listDeposits(redis, userId, 1, 200)
  return orders.filter((o) => o.status === 'paid' && o.orderId !== excludeOrderId).length
}

/**
 * 被邀请人「首笔成功充值」处理邀请达标：仅第一笔 paid 订单参与判定；
 * 该笔折算 PHP ≥ ₱100 时邀请人 referralReady。
 */
async function applyReferralMilestone(
  redis: Redis,
  inviteeUserId: string,
  orderId: string,
  creditedCents: number,
): Promise<void> {
  const invitee = await getUser(redis, inviteeUserId)
  if (!invitee?.referredBy || invitee.referralMilestoneMet) return

  const priorPaid = await countPaidDeposits(redis, inviteeUserId, orderId)
  if (priorPaid > 0) return

  invitee.referralMilestoneMet = true
  await saveUser(redis, invitee)

  if (creditedCents < REFERRAL_MIN_DEPOSIT_CENTS) return

  const inviter = await getUser(redis, invitee.referredBy)
  if (!inviter || inviter.referralClaimed) return
  inviter.referralReady = true
  await saveUser(redis, inviter)
}

async function applyFirstDepPromo(redis: Redis, userId: string): Promise<void> {
  const user = await getUser(redis, userId)
  if (!user || user.firstDepClaimed || user.firstDepReady) return
  user.firstDepReady = true
  await saveUser(redis, user)
}

/**
 * 充值成功：入账、首充活动、邀请达标。
 * @param amountPhpUnits POST body 金额（PHP 比索或 USDT 数量，由 currency 决定）
 */
export async function settlePaidDeposit(
  redis: Redis,
  order: DepositOrder,
  opts: {
    traceId?: string
    usdtToPhpRate: number
    amountPhpUnits: number
    currency: DepositCurrency
  },
): Promise<DepositOrder> {
  const creditedCents = depositAmountToCents(opts.amountPhpUnits, opts.currency, opts.usdtToPhpRate)
  if (creditedCents <= 0) {
    throw new Error('Invalid deposit amount')
  }

  order.status = 'paid'
  order.paidAt = nowIso()
  order.creditedCents = creditedCents
  await saveDeposit(redis, order)

  await creditWallet(redis, order.userId, creditedCents, {
    type: 'deposit',
    refId: order.orderId,
    description:
      opts.currency === 'USDT'
        ? `USDT deposit (≈ ₱${(creditedCents / 100).toFixed(2)})`
        : 'Telegram Wallet deposit',
    createdAt: nowIso(),
    traceId: opts.traceId,
  })

  await applyFirstDepPromo(redis, order.userId)
  await applyReferralMilestone(redis, order.userId, order.orderId, creditedCents)

  return order
}

export async function markDepositPaidFromWebhook(
  redis: Redis,
  orderId: string,
  opts: { traceId?: string; usdtToPhpRate: number },
): Promise<DepositOrder | null> {
  const order = await getDeposit(redis, orderId)
  if (!order || order.status === 'paid') return order

  return settlePaidDeposit(redis, order, {
    traceId: opts.traceId,
    usdtToPhpRate: opts.usdtToPhpRate,
    amountPhpUnits: order.amount,
    currency: order.currency,
  })
}
