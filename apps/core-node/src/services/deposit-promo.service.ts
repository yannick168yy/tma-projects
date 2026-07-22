import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { lgId } from '../utils/id.js'

/**
 * 充值成功后的活动发放：首充嘉年华。
 * 挂在所有入账路径（internal.routes 两条 + NATS yfpay/beepay 回调）之后调用，
 * 幂等由 bg_user_promo_state.first_dep_claimed 条件更新保证，发放失败不影响充值主流程。
 */
export interface PaidDepositInfo {
  orderId: string
  userId: string
  /** 该笔充值金额（订单币种单位） */
  amount: number
  currency: string
}

interface FirstDepTier { depositAmount: number; bonusAmount: number }

async function loadPromoKv(db: Pool, promoId: string): Promise<Record<string, string>> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT config_key, config_value FROM bg_promo_config WHERE promo_id = ?',
    [promoId],
  )
  const map: Record<string, string> = {}
  for (const r of rows) map[String(r.config_key)] = String(r.config_value)
  return map
}

function matchFirstDepBonus(tiers: FirstDepTier[], amount: number): number {
  let bonus = 0
  let best = -1
  for (const tier of tiers) {
    if (amount >= tier.depositAmount && tier.depositAmount > best) {
      best = tier.depositAmount
      bonus = tier.bonusAmount
    }
  }
  return bonus
}

function turnoverExpiresAt(days: number): string | null {
  if (days <= 0) return null
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ')
}

/** 奖励入账 + ledger + 流水要求，单事务 */
async function creditBonus(
  db: Pool,
  userId: string,
  amount: number,
  currency: string,
  description: string,
  refId: string,
  turnoverX: number,
  turnoverDays: number,
  sourceRef: string,
): Promise<void> {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      `INSERT INTO bg_wallet (user_id, currency, available, version)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
      [userId, currency, amount, amount],
    )
    const [[wallet]] = await conn.query<RowDataPacket[]>(
      'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?',
      [userId, currency],
    )
    await conn.execute(
      `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
       VALUES (?, ?, ?, 'bonus', ?, ?, 'promo', ?, ?)`,
      [lgId(), userId, currency, amount, Number(wallet?.available ?? 0), refId, description],
    )
    if (turnoverX > 0) {
      const required = Math.round(amount * turnoverX * 10000) / 10000
      await conn.execute(
        `INSERT INTO bg_turnover_requirements (user_id, currency, source_type, source_ref, required_amount, expires_at)
         VALUES (?, ?, 'promotion', ?, ?, ?)`,
        [userId, currency, sourceRef, required, turnoverExpiresAt(turnoverDays)],
      )
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** 首充嘉年华：仅首笔成功充值，按币种向下匹配档位自动发放 */
async function applyFirstDepBonus(db: Pool, dep: PaidDepositInfo): Promise<void> {
  const [users] = await db.query<RowDataPacket[]>(
    'SELECT first_dep_claimed, first_dep_ready FROM bg_user_promo_state WHERE user_id = ? LIMIT 1',
    [dep.userId],
  )
  const user = users[0]
  if (!user || Number(user.first_dep_claimed) || Number(user.first_dep_ready)) return

  const [prior] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM bg_deposit_order WHERE user_id = ? AND status = 'paid' AND order_id != ? LIMIT 1",
    [dep.userId, dep.orderId],
  )
  if (prior.length > 0) return

  const cfg = await loadPromoKv(db, 'firstdep')
  if (cfg.enabled !== undefined && cfg.enabled !== '1') return
  const [tierRows] = await db.query<RowDataPacket[]>(
    'SELECT deposit_amount, bonus_amount FROM bg_firstdep_tiers WHERE currency = ?',
    [dep.currency],
  )
  const bonus = matchFirstDepBonus(
    tierRows.map((r) => ({ depositAmount: Number(r.deposit_amount), bonusAmount: Number(r.bonus_amount) })),
    dep.amount,
  )
  if (bonus <= 0) return

  // 条件更新做幂等闸：并发回调只有一个能置位成功
  const [res] = await db.execute<ResultSetHeader>(
    'UPDATE bg_user_promo_state SET first_dep_claimed = 1 WHERE user_id = ? AND first_dep_claimed = 0',
    [dep.userId],
  )
  if (res.affectedRows === 0) return

  await creditBonus(
    db, dep.userId, bonus, dep.currency, 'First deposit bonus', dep.orderId,
    Number(cfg.turnover_x ?? 15), Number(cfg.turnover_days ?? 30), 'firstdep',
  )
}

export async function applyDepositPromos(
  db: Pool,
  dep: PaidDepositInfo,
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    await applyFirstDepBonus(db, dep)
  } catch (err) {
    log.error({ err, orderId: dep.orderId }, 'first deposit bonus failed')
  }
}
