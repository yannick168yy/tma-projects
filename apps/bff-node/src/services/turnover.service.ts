import type { Pool, RowDataPacket } from 'mysql2/promise'

export interface TurnoverRequirement {
  id: number
  sourceType: 'deposit' | 'promotion'
  sourceRef: string
  requiredAmount: number
  completedAmount: number
  status: 'pending' | 'completed' | 'expired' | 'cancelled'
  expiresAt: string | null
  createdAt: string
}

export interface TurnoverProgress {
  canWithdraw: boolean
  totalRemaining: number
  requirements: TurnoverRequirement[]
}

export async function createDepositRequirement(
  pool: Pool,
  userId: string,
  orderId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return
  await pool.execute(
    `INSERT IGNORE INTO bg_turnover_requirements
       (user_id, source_type, source_ref, required_amount)
     VALUES (?, 'deposit', ?, ?)`,
    [userId, orderId, amount],
  )
}

export async function createPromoRequirement(
  pool: Pool,
  userId: string,
  promoType: string,
  amount: number,
  multiplier: number,
  expiresAt: string | null = null,
): Promise<void> {
  const required = Math.round(amount * multiplier * 10000) / 10000
  if (required <= 0) return
  await pool.execute(
    `INSERT IGNORE INTO bg_turnover_requirements
       (user_id, source_type, source_ref, required_amount, expires_at)
     VALUES (?, 'promotion', ?, ?, ?)`,
    [userId, promoType, required, expiresAt],
  )
}

export async function getTurnoverProgress(
  pool: Pool,
  userId: string,
): Promise<TurnoverProgress> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, source_type, source_ref, required_amount, completed_amount,
            status, expires_at, created_at
     FROM bg_turnover_requirements
     WHERE user_id = ?
     ORDER BY FIELD(status,'pending','completed','expired','cancelled'), created_at ASC`,
    [userId],
  )

  const requirements: TurnoverRequirement[] = rows.map((r) => ({
    id: Number(r.id),
    sourceType: r.source_type as 'deposit' | 'promotion',
    sourceRef: String(r.source_ref),
    requiredAmount: Number(r.required_amount),
    completedAmount: Number(r.completed_amount),
    status: r.status as TurnoverRequirement['status'],
    expiresAt: r.expires_at ? new Date(r.expires_at as Date).toISOString() : null,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))

  const pending = requirements.filter((r) => r.status === 'pending')
  const totalRemaining = pending.reduce((s, r) => s + (r.requiredAmount - r.completedAmount), 0)

  return {
    canWithdraw: totalRemaining <= 0,
    totalRemaining: Math.max(0, totalRemaining),
    requirements,
  }
}

export async function canWithdraw(pool: Pool, userId: string): Promise<boolean> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(required_amount - completed_amount), 0) AS remaining
     FROM bg_turnover_requirements
     WHERE user_id = ? AND status = 'pending'`,
    [userId],
  )
  return Number(row?.remaining ?? 0) <= 0
}
