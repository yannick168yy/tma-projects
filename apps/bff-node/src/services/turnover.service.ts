import type { Pool, RowDataPacket } from 'mysql2/promise'

export interface TurnoverRequirement {
  id: number
  sourceType: 'deposit' | 'promotion'
  sourceRef: string
  currency: string
  baseAmount: number
  requiredAmount: number
  completedAmount: number
  status: 'pending' | 'completed' | 'expired' | 'cancelled'
  expiresAt: string | null
  createdAt: string
}

export interface TurnoverProgress {
  canWithdraw: boolean
  totalRemaining: number
  /** 存款类要求剩余流水（1倍 AML） */
  depositRemaining: number
  /** 未解锁彩金本金合计（前端存款引导分支判定用） */
  lockedBonus: number
  requirements: TurnoverRequirement[]
}

export interface WithdrawGate {
  /** 所有 pending 流水要求（存款+彩金）已清零 */
  ok: boolean
  depositRemaining: number
  lockedBonus: number
}

export async function createDepositRequirement(
  pool: Pool,
  userId: string,
  orderId: string,
  amount: number,
  currency = 'PHP',
): Promise<void> {
  if (amount <= 0) return
  await pool.execute(
    `INSERT IGNORE INTO bg_turnover_requirements
       (user_id, currency, source_type, source_ref, base_amount, required_amount)
     VALUES (?, ?, 'deposit', ?, ?, ?)`,
    [userId, currency, orderId, amount, amount],
  )
}

export async function createPromoRequirement(
  pool: Pool,
  userId: string,
  promoType: string,
  amount: number,
  multiplier: number,
  expiresAt: string | null = null,
  currency = 'PHP',
): Promise<void> {
  const required = Math.round(amount * multiplier * 10000) / 10000
  if (required <= 0) return
  await pool.execute(
    `INSERT IGNORE INTO bg_turnover_requirements
       (user_id, currency, source_type, source_ref, base_amount, required_amount, expires_at)
     VALUES (?, ?, 'promotion', ?, ?, ?, ?)`,
    [userId, currency, promoType, amount, required, expiresAt],
  )
}

export async function getTurnoverProgress(
  pool: Pool,
  userId: string,
  currency?: string,
): Promise<TurnoverProgress> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, source_type, source_ref, currency, base_amount, required_amount, completed_amount,
            status, expires_at, created_at
     FROM bg_turnover_requirements
     WHERE user_id = ? ${currency ? 'AND currency = ?' : ''}
     ORDER BY FIELD(status,'pending','completed','expired','cancelled'), created_at ASC`,
    currency ? [userId, currency] : [userId],
  )

  const requirements: TurnoverRequirement[] = rows.map((r) => ({
    id: Number(r.id),
    sourceType: r.source_type as 'deposit' | 'promotion',
    sourceRef: String(r.source_ref),
    currency: String(r.currency ?? 'PHP'),
    baseAmount: Number(r.base_amount ?? r.required_amount),
    requiredAmount: Number(r.required_amount),
    completedAmount: Number(r.completed_amount),
    status: r.status as TurnoverRequirement['status'],
    expiresAt: r.expires_at ? new Date(r.expires_at as Date).toISOString() : null,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))

  const pending = requirements.filter((r) => r.status === 'pending')
  const totalRemaining = pending.reduce((s, r) => s + (r.requiredAmount - r.completedAmount), 0)
  const depositRemaining = pending
    .filter((r) => r.sourceType === 'deposit')
    .reduce((s, r) => s + (r.requiredAmount - r.completedAmount), 0)
  const lockedBonus = pending
    .filter((r) => r.sourceType === 'promotion')
    .reduce((s, r) => s + r.baseAmount, 0)

  return {
    canWithdraw: totalRemaining <= 0,
    totalRemaining: Math.max(0, totalRemaining),
    depositRemaining: Math.max(0, depositRemaining),
    lockedBonus: Math.max(0, lockedBonus),
    requirements,
  }
}

// 提款闸门：所有 pending 流水要求（存款+彩金）全部清零才可提款。
// 彩金及其衍生盈利在流水打完前整体锁定——只锁本金会让彩金盈利经 1 倍存款流水套现。
export async function getWithdrawGate(pool: Pool, userId: string, currency = 'PHP'): Promise<WithdrawGate> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(required_amount - completed_amount), 0) AS remaining,
       COALESCE(SUM(IF(source_type = 'deposit', required_amount - completed_amount, 0)), 0) AS deposit_remaining,
       COALESCE(SUM(IF(source_type = 'promotion', COALESCE(base_amount, required_amount), 0)), 0) AS locked_bonus
     FROM bg_turnover_requirements
     WHERE user_id = ? AND currency = ? AND status = 'pending'`,
    [userId, currency],
  )
  const depositRemaining = Math.max(0, Number(row?.deposit_remaining ?? 0))
  const lockedBonus = Math.max(0, Number(row?.locked_bonus ?? 0))
  return { ok: Number(row?.remaining ?? 0) <= 0, depositRemaining, lockedBonus }
}
