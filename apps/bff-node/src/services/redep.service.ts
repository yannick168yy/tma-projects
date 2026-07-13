import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getRedepConfigByPool } from './promo-config.service.js'
import { creditWallet } from './store/index.js'
import { createPromoRequirement } from './turnover.service.js'
import { evaluateWithPool } from './risk.service.js'
import { nowIso } from '../utils/format.js'

export interface RedepOffer {
  active: boolean
  currency?: string
  endsAt?: string
  minDeposit?: number
  bonusAmount?: number
}

/** PHT 当日 00:00 对应的 UTC 时间串（bg_deposit_order 时间列按 UTC 存） */
function phtDayStartUtc(): string {
  const phtMs = Date.now() + 8 * 3600 * 1000
  const d = new Date(phtMs)
  const startPht = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return new Date(startPht - 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()
}

/**
 * 进站触发：已首充且当日未充值的用户，无未过期窗口且过了冷却期时开一个新窗口。
 * 返回当前生效的优惠（含刚开的），不满足条件返回 { active: false }。
 */
export async function getOrCreateRedepOffer(env: Env, userId: string, currency = 'PHP'): Promise<RedepOffer> {
  if (!isMysqlEnabled(env)) return { active: false }
  const pool = getMysqlPool(env)
  const cfg = await getRedepConfigByPool(pool)
  // 每币种独立门槛/奖励；该币种未配或为 0 则本币种不触发
  const tier = cfg.byCcy?.[currency] ?? { minDeposit: cfg.minDeposit, bonusAmount: cfg.bonusAmount }
  if (!cfg.enabled || tier.bonusAmount <= 0 || tier.minDeposit <= 0) return { active: false }

  // 已有未使用且未过期的窗口（同币种）→ 直接返回（不重复计时）
  const [openRows] = await pool.query<RowDataPacket[]>(
    `SELECT min_deposit, bonus_amount, ends_at FROM bg_redep_offer
     WHERE user_id = ? AND currency = ? AND claimed_at IS NULL AND ends_at > NOW(3)
     ORDER BY ends_at DESC LIMIT 1`,
    [userId, currency],
  )
  if (openRows.length > 0) {
    const w = openRows[0]
    return { active: true, currency, endsAt: toIso(w.ends_at), minDeposit: Number(w.min_deposit), bonusAmount: Number(w.bonus_amount) }
  }

  // 复充人群（同币种）：曾有该币种成功充值，且今日（PHT）尚未该币种充值
  const [depRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       EXISTS(SELECT 1 FROM bg_deposit_order WHERE user_id = ? AND currency = ? AND status = 'paid') AS has_paid,
       EXISTS(SELECT 1 FROM bg_deposit_order WHERE user_id = ? AND currency = ? AND status = 'paid' AND updated_at >= ?) AS paid_today`,
    [userId, currency, userId, currency, phtDayStartUtc()],
  )
  if (!Number(depRows[0]?.has_paid) || Number(depRows[0]?.paid_today)) return { active: false }

  // 冷却（同币种）：距上一个该币种窗口开启不足 cooldownDays 不再触发
  const [coolRows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM bg_redep_offer
     WHERE user_id = ? AND currency = ? AND starts_at > DATE_SUB(NOW(3), INTERVAL ? DAY) LIMIT 1`,
    [userId, currency, cfg.cooldownDays],
  )
  if (coolRows.length > 0) return { active: false }

  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO bg_redep_offer (user_id, currency, min_deposit, bonus_amount, starts_at, ends_at)
     VALUES (?, ?, ?, ?, NOW(3), DATE_ADD(NOW(3), INTERVAL ? HOUR))`,
    [userId, currency, tier.minDeposit, tier.bonusAmount, cfg.windowHours],
  )
  const [newRows] = await pool.query<RowDataPacket[]>(
    'SELECT min_deposit, bonus_amount, ends_at FROM bg_redep_offer WHERE id = ?',
    [ins.insertId],
  )
  const w = newRows[0]
  return { active: true, currency, endsAt: toIso(w.ends_at), minDeposit: Number(w.min_deposit), bonusAmount: Number(w.bonus_amount) }
}

/**
 * 充值成功结算钩子：窗口内且金额达标（按已折算 PHP 金额）→ 发奖励并关闭窗口（每窗口一次）。
 * 原子抢占：UPDATE ... WHERE claimed_at IS NULL 命中才发放，webhook 重试不会重复发。
 */
export async function applyRedepPromo(
  redis: Redis,
  pool: Pool,
  userId: string,
  orderId: string,
  creditedAmount: number,
  currency: string,
  traceId?: string,
): Promise<void> {
  if (creditedAmount <= 0) return
  // 同币种窗口内、该币种达标额（原币种口径，非折算 PHP）→ 原子抢占
  const [claim] = await pool.query<ResultSetHeader>(
    `UPDATE bg_redep_offer SET claimed_at = NOW(3), claimed_order_id = ?
     WHERE user_id = ? AND currency = ? AND claimed_at IS NULL AND ends_at > NOW(3) AND min_deposit <= ?
     ORDER BY ends_at DESC LIMIT 1`,
    [orderId, userId, currency, creditedAmount],
  )
  if (claim.affectedRows === 0) return

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT bonus_amount FROM bg_redep_offer WHERE claimed_order_id = ? AND user_id = ? LIMIT 1',
    [orderId, userId],
  )
  const bonus = Number(rows[0]?.bonus_amount ?? 0)
  if (bonus <= 0) return

  // 与首充同口径：webhook 无 ctx，按 userId 过风控名单
  const decision = await evaluateWithPool(pool, { checkpoint: 'promo_claim', userId })
  if (decision.action === 'deny') return

  await creditWallet(redis, userId, bonus, {
    type: 'bonus',
    currency,
    description: 'Redeposit limited-time bonus',
    createdAt: nowIso(),
    traceId,
  })

  const cfg = await getRedepConfigByPool(pool)
  if (cfg.turnoverX > 0) {
    const expiresAt = cfg.turnoverDays > 0
      ? new Date(Date.now() + cfg.turnoverDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      : null
    await createPromoRequirement(pool, userId, `redep:${orderId}`, bonus, cfg.turnoverX, expiresAt, currency)
  }
}
