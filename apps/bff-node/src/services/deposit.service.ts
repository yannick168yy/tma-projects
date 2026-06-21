import type { Redis } from 'ioredis'
import type { Pool } from 'mysql2/promise'
import type { DepositOrder } from '../types/domain.js'
import { REFERRAL_MIN_DEPOSIT_CENTS } from '../constants/referral.js'
import {
  creditWallet,
  getDeposit,
  getUser,
  listDeposits,
  saveDeposit,
  saveUser,
} from './store/index.js'
import { nowIso } from '../utils/format.js'
import { createDepositRequirement, createPromoRequirement } from './turnover.service.js'
import { getFirstDepConfigByPool, matchFirstDepBonus, PROMO_DEFAULTS } from './promo-config.service.js'

export type DepositCurrency = 'PHP' | 'USDT' | 'TON'

export function depositAmountToYuan(
  amount: number,
  currency: DepositCurrency,
  usdtToPhpRate: number,
  tonToPhpRate = 0,
): number {
  if (currency === 'PHP') return Math.round(amount * 100) / 100
  if (currency === 'USDT') {
    if (amount <= 0 || usdtToPhpRate <= 0) return 0
    return Math.round(amount * usdtToPhpRate * 100) / 100
  }
  if (currency === 'TON') {
    if (amount <= 0 || tonToPhpRate <= 0) return 0
    return Math.round(amount * tonToPhpRate * 100) / 100
  }
  return 0
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

/**
 * 首充嘉年华：仅首充一次，充值成功后按「该笔充值币种」向下匹配档位自动发同币种奖励。
 * 命中档位（bonus>0）才消耗首充资格；低于最小档位不发奖励、也不消耗资格。
 */
async function applyFirstDepPromo(
  redis: Redis,
  userId: string,
  depositAmount: number,
  currency: string,
  opts: { pool?: Pool; traceId?: string },
): Promise<void> {
  const user = await getUser(redis, userId)
  if (!user || user.firstDepClaimed || user.firstDepReady) return

  const cfg = opts.pool ? await getFirstDepConfigByPool(opts.pool) : PROMO_DEFAULTS.firstdep
  if (!cfg.enabled) return
  const bonus = matchFirstDepBonus(cfg.tiers[currency], depositAmount)
  if (bonus <= 0) return

  user.firstDepClaimed = true
  await saveUser(redis, user)

  await creditWallet(redis, userId, bonus, {
    type: 'bonus',
    description: 'First deposit bonus',
    createdAt: nowIso(),
    traceId: opts.traceId,
    ...(currency !== 'PHP' ? { currency } : {}),
  })

  if (cfg.turnoverX > 0 && opts.pool) {
    const expiresAt = cfg.turnoverDays > 0
      ? new Date(Date.now() + cfg.turnoverDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      : null
    await createPromoRequirement(opts.pool, userId, 'firstdep', bonus, cfg.turnoverX, expiresAt, currency)
  }
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
    tonToPhpRate?: number
    amountPhpUnits: number
    currency: DepositCurrency
    mysqlPool?: Pool
    multiCurrency?: boolean
  },
): Promise<DepositOrder> {
  let credited: number
  let creditedCurrency: string

  if (opts.multiCurrency) {
    credited = Math.round(opts.amountPhpUnits * 10000) / 10000
    creditedCurrency = opts.currency
  } else {
    credited = depositAmountToYuan(opts.amountPhpUnits, opts.currency, opts.usdtToPhpRate, opts.tonToPhpRate ?? 0)
    creditedCurrency = 'PHP'
  }

  if (credited <= 0) throw new Error('Invalid deposit amount')

  order.status = 'paid'
  order.paidAt = nowIso()
  order.creditedCents = credited
  await saveDeposit(redis, order)

  let description: string
  if (opts.multiCurrency) {
    description = `${opts.currency} deposit`
  } else if (opts.currency === 'USDT') {
    description = `USDT deposit (≈ ₱${credited.toFixed(2)})`
  } else if (opts.currency === 'TON') {
    description = `TON deposit (≈ ₱${credited.toFixed(2)})`
  } else {
    description = 'Telegram Wallet deposit'
  }

  await creditWallet(redis, order.userId, credited, {
    type: 'deposit',
    refId: order.orderId,
    description,
    createdAt: nowIso(),
    traceId: opts.traceId,
    ...(creditedCurrency !== 'PHP' ? { currency: creditedCurrency } : {}),
  })

  await applyFirstDepPromo(redis, order.userId, opts.amountPhpUnits, opts.currency, { pool: opts.mysqlPool, traceId: opts.traceId })
  await applyReferralMilestone(redis, order.userId, order.orderId, credited)

  if (opts.mysqlPool) {
    await createDepositRequirement(opts.mysqlPool, order.userId, order.orderId, credited, creditedCurrency)
  }

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
