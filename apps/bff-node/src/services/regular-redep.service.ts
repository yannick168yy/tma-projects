import { randomUUID } from 'node:crypto'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { evaluateWithPool } from './risk.service.js'
import { creditWalletTx } from './store/mysql-store.js'

interface RegularRedepTier { depositAmount: number; bonusAmount: number }

function matchTier(tiers: RegularRedepTier[], amount: number): number {
  let matchedAmount = -1
  let bonus = 0
  for (const tier of tiers) {
    if (amount >= tier.depositAmount && tier.depositAmount > matchedAmount) {
      matchedAmount = tier.depositAmount
      bonus = tier.bonusAmount
    }
  }
  return bonus
}

/** 兼容仍由 BFF 直接入账的充值路径；order_id 唯一索引负责跨服务幂等。 */
export async function createRegularRedepClaim(
  db: Pool,
  userId: string,
  orderId: string,
  amount: number,
  currency: string,
): Promise<void> {
  const [configRows] = await db.query<RowDataPacket[]>(
    "SELECT config_key,config_value FROM bg_promo_config WHERE promo_id='redep_regular'",
  )
  const config: Record<string, string> = {}
  for (const row of configRows) config[String(row.config_key)] = String(row.config_value)
  if (config.enabled !== '1') return

  let tiers: Record<string, RegularRedepTier[]>
  let dailyCaps: Record<string, number>
  try {
    tiers = JSON.parse(config.tiers ?? '{}') as Record<string, RegularRedepTier[]>
    dailyCaps = JSON.parse(config.daily_bonus_caps ?? '{}') as Record<string, number>
  } catch { return }

  const [prior] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM bg_deposit_order WHERE user_id=? AND status='paid' AND channel<>'admin' AND order_id<>? LIMIT 1",
    [userId, orderId],
  )
  if (prior.length === 0) return

  if (config.stack_with_limited !== '1') {
    const [limited] = await db.query<RowDataPacket[]>(
      `SELECT 1 FROM bg_redep_offer
       WHERE user_id=? AND currency=? AND (
         claimed_order_id=? OR (claimed_at IS NULL AND ends_at>NOW(3) AND min_deposit<=?)
       ) LIMIT 1`,
      [userId, currency, orderId, amount],
    )
    if (limited.length > 0) return
  }

  const bonus = matchTier(tiers[currency] ?? [], amount)
  if (bonus <= 0) return
  const offset = currency === 'IDR' ? 7 : 8
  const [[daily]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) cnt,COALESCE(SUM(bonus_amount),0) bonus
     FROM bg_regular_redep_claim
     WHERE user_id=? AND currency=? AND status IN ('pending','claimed')
       AND DATE(DATE_ADD(created_at,INTERVAL ${offset} HOUR))=DATE(DATE_ADD(NOW(3),INTERVAL ${offset} HOUR))`,
    [userId, currency],
  )
  if (Number(daily?.cnt ?? 0) >= Number(config.daily_max_claims ?? 3)) return
  const cap = Number(dailyCaps[currency] ?? 0)
  if (cap > 0 && Number(daily?.bonus ?? 0) + bonus > cap) return

  await db.execute(
    `INSERT IGNORE INTO bg_regular_redep_claim
       (order_id,user_id,currency,deposit_amount,bonus_amount,turnover_x,turnover_days,expires_at)
     VALUES (?,?,?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL ? HOUR))`,
    [orderId, userId, currency, amount, bonus, Number(config.turnover_x ?? 3),
      Number(config.turnover_days ?? 30), Number(config.claim_hours ?? 24)],
  )
}

export interface RegularRedepClaim {
  id: number
  orderId: string
  currency: string
  depositAmount: number
  bonusAmount: number
  turnoverX: number
  turnoverRequired: number
  expiresAt: string
  status: string
}

const toIso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()

export async function listRegularRedepClaims(env: Env, userId: string, currency?: string): Promise<RegularRedepClaim[]> {
  const db = getMysqlPool(env)
  await db.execute(
    `UPDATE bg_regular_redep_claim SET status='expired'
     WHERE user_id=? AND status='pending' AND expires_at<=NOW(3)`, [userId],
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id,order_id,currency,deposit_amount,bonus_amount,turnover_x,expires_at,status
     FROM bg_regular_redep_claim
     WHERE user_id=? AND status='pending' AND expires_at>NOW(3)${currency ? ' AND currency=?' : ''}
     ORDER BY created_at DESC`, currency ? [userId, currency] : [userId],
  )
  return rows.map((row) => ({
    id: Number(row.id), orderId: String(row.order_id), currency: String(row.currency),
    depositAmount: Number(row.deposit_amount), bonusAmount: Number(row.bonus_amount),
    turnoverX: Number(row.turnover_x), turnoverRequired: Number(row.bonus_amount) * Number(row.turnover_x),
    expiresAt: toIso(row.expires_at), status: String(row.status),
  }))
}

export async function claimRegularRedep(env: Env, userId: string, claimId: number): Promise<{ amount: number; currency: string; turnoverRequired: number }> {
  const db = getMysqlPool(env)
  const decision = await evaluateWithPool(db, { checkpoint: 'promo_claim', userId })
  if (decision.action === 'deny') throw new Error('errors.promoNotEligible')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [[claim]] = await conn.query<RowDataPacket[]>(
      `SELECT c.*, d.status deposit_status,
              COALESCE((SELECT config_value FROM bg_promo_config WHERE promo_id='redep_regular' AND config_key='stack_with_limited'),'0') stack_with_limited,
              EXISTS(SELECT 1 FROM bg_redep_offer r WHERE r.claimed_order_id=c.order_id) limited_claimed
       FROM bg_regular_redep_claim c
       JOIN bg_deposit_order d ON d.order_id=c.order_id
       WHERE c.id=? AND c.user_id=? FOR UPDATE`, [claimId, userId],
    )
    if (!claim || claim.status !== 'pending') throw new Error('errors.promoAlreadyClaimed')
    if (new Date(claim.expires_at as Date).getTime() <= Date.now()) {
      throw new Error('errors.promoExpired')
    }
    if (String(claim.deposit_status) !== 'paid') throw new Error('errors.promoNotEligible')
    if (String(claim.stack_with_limited) !== '1' && Number(claim.limited_claimed)) {
      throw new Error('errors.promoNotEligible')
    }
    const amount = Number(claim.bonus_amount)
    const currency = String(claim.currency)
    const ledgerId = randomUUID()
    await creditWalletTx(conn, userId, amount, {
      id: ledgerId, currency, type: 'bonus', refType: 'promo', refId: String(claim.order_id),
      description: 'Regular redeposit bonus',
    })
    const turnoverRequired = Math.round(amount * Number(claim.turnover_x) * 10000) / 10000
    if (turnoverRequired > 0) {
      const expiresAt = Number(claim.turnover_days) > 0
        ? new Date(Date.now() + Number(claim.turnover_days) * 86400000).toISOString().slice(0, 19).replace('T', ' ')
        : null
      await conn.execute(
        `INSERT INTO bg_turnover_requirements
         (user_id,currency,source_type,source_ref,base_amount,required_amount,expires_at)
         VALUES (?,?,'promotion',?,?,?,?)`,
        [userId, currency, `regular_redep:${claim.order_id}`, amount, turnoverRequired, expiresAt],
      )
    }
    await conn.execute(
      `UPDATE bg_regular_redep_claim SET status='claimed',claimed_at=NOW(3),ledger_id=? WHERE id=?`,
      [ledgerId, claimId],
    )
    await conn.commit()
    return { amount, currency, turnoverRequired }
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}
