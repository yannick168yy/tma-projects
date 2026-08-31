import type { Redis } from 'ioredis'
import type { Pool } from 'mysql2/promise'
import type { DepositOrder } from '../types/domain.js'
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
import { evaluateWithPool } from './risk.service.js'
import { applyRedepPromo } from './redep.service.js'
import { createRegularRedepClaim } from './regular-redep.service.js'

export type DepositCurrency = 'PHP' | 'USDT' | 'USDC' | 'IDR'

export function depositAmountToYuan(
  amount: number,
  currency: DepositCurrency,
  usdtToPhpRate: number,
): number {
  if (currency === 'PHP') return Math.round(amount * 100) / 100
  if (currency === 'USDT' || currency === 'USDC') {
    if (amount <= 0 || usdtToPhpRate <= 0) return 0
    return Math.round(amount * usdtToPhpRate * 100) / 100
  }
  return 0
}

async function countPaidDeposits(redis: Redis, userId: string, excludeOrderId?: string): Promise<number> {
  const orders = await listDeposits(redis, userId, 1, 200)
  return orders.filter((o) => o.status === 'paid' && o.orderId !== excludeOrderId).length
}

/**
 * 首充嘉年华：仅首充一次，充值成功后按「该笔充值币种」向下匹配档位自动发同币种奖励。
 * 命中档位（bonus>0）才消耗首充资格；低于最小档位不发奖励、也不消耗资格。
 */
async function applyFirstDepPromo(
  redis: Redis,
  userId: string,
  orderId: string,
  depositAmount: number,
  currency: string,
  opts: { pool?: Pool; traceId?: string },
): Promise<void> {
  const user = await getUser(redis, userId)
  if (!user || user.firstDepClaimed || user.firstDepReady) return
  if (await countPaidDeposits(redis, userId, orderId) > 0) return

  const cfg = opts.pool ? await getFirstDepConfigByPool(opts.pool) : PROMO_DEFAULTS.firstdep
  if (!cfg.enabled) return
  const bonus = matchFirstDepBonus(cfg.tiers[currency], depositAmount)
  if (bonus <= 0) return

  // 走支付 webhook 无 ctx，拿不到 ip/device，只能按 userId 判风控（用户名单 + 行为规则）
  if (opts.pool) {
    const decision = await evaluateWithPool(opts.pool, { checkpoint: 'promo_claim', userId })
    if (decision.action === 'deny') return
  }

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
    credited = depositAmountToYuan(opts.amountPhpUnits, opts.currency, opts.usdtToPhpRate)
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

  await applyFirstDepPromo(redis, order.userId, order.orderId, opts.amountPhpUnits, opts.currency, { pool: opts.mysqlPool, traceId: opts.traceId })

  // 复充限时优惠：按币种独立，达标额与发奖均用原币种（credited/creditedCurrency 即入账原币种口径）
  if (opts.mysqlPool) {
    await applyRedepPromo(redis, opts.mysqlPool, order.userId, order.orderId, credited, creditedCurrency, opts.traceId)
    await createRegularRedepClaim(opts.mysqlPool, order.userId, order.orderId, credited, creditedCurrency)
  }

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
