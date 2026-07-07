import type { Pool, RowDataPacket } from 'mysql2/promise'

// 运营引擎 P1：用户分层重算。每日 cron 全量刷新 bg_user_segment，
// 供触达中心「选人群」与定向发券做 WHERE 组合过滤。
// 分类阈值放这里（纯函数，可单测），SQL 只负责取原始聚合。

export type Lifecycle = 'new' | 'active' | 'dormant' | 'churned'
export type ValueTier = 'none' | 'low' | 'mid' | 'high' | 'vip'

const DAY_MS = 24 * 60 * 60 * 1000

/** 生命周期分界（天） */
export const NEW_WINDOW_DAYS = 7
export const ACTIVE_WINDOW_DAYS = 7
export const DORMANT_WINDOW_DAYS = 30

/** 价值档分界（PHP，与 credited_cents 同单位） */
export const VALUE_TIER_BOUNDS = { low: 1000, mid: 10000, high: 50000 } as const

export interface SegmentInput {
  registeredAt: Date
  lastActiveAt: Date | null // 登录/充值取大；null = 注册后无活动
  totalDeposit: number
  depositCount: number
  isAgent: boolean
  reachableTg: boolean
}

export interface SegmentResult {
  lifecycle: Lifecycle
  deposited: boolean
  valueTier: ValueTier
  isAgent: boolean
  reachableTg: boolean
  totalDeposit: number
  depositCount: number
  lastActiveAt: Date | null
  daysSinceActive: number
}

function daysBetween(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / DAY_MS)
}

export function classifyLifecycle(input: SegmentInput, now: Date): { lifecycle: Lifecycle; daysSinceActive: number } {
  const ref = input.lastActiveAt ?? input.registeredAt
  const daysSinceActive = Math.max(0, daysBetween(ref, now))
  const registeredDays = Math.max(0, daysBetween(input.registeredAt, now))

  let lifecycle: Lifecycle
  if (registeredDays <= NEW_WINDOW_DAYS) lifecycle = 'new'
  else if (daysSinceActive <= ACTIVE_WINDOW_DAYS) lifecycle = 'active'
  else if (daysSinceActive <= DORMANT_WINDOW_DAYS) lifecycle = 'dormant'
  else lifecycle = 'churned'
  return { lifecycle, daysSinceActive }
}

export function classifyValueTier(totalDeposit: number, depositCount: number): ValueTier {
  if (depositCount <= 0 || totalDeposit <= 0) return 'none'
  if (totalDeposit < VALUE_TIER_BOUNDS.low) return 'low'
  if (totalDeposit < VALUE_TIER_BOUNDS.mid) return 'mid'
  if (totalDeposit < VALUE_TIER_BOUNDS.high) return 'high'
  return 'vip'
}

export function classifySegment(input: SegmentInput, now: Date): SegmentResult {
  const { lifecycle, daysSinceActive } = classifyLifecycle(input, now)
  return {
    lifecycle,
    deposited: input.depositCount > 0,
    valueTier: classifyValueTier(input.totalDeposit, input.depositCount),
    isAgent: input.isAgent,
    reachableTg: input.reachableTg,
    totalDeposit: input.totalDeposit,
    depositCount: input.depositCount,
    lastActiveAt: input.lastActiveAt,
    daysSinceActive,
  }
}

interface RawUserRow extends RowDataPacket {
  id: string
  registered_at: Date
  telegram_user_id: string | number | null
  deposit_count: number
  total_deposit: string | number
  last_paid_at: Date | null
  last_login_at: Date | null
  is_agent: number
}

/** 全量重算所有 active 用户的分层快照，批量 upsert。返回处理行数。 */
export async function recomputeSegments(pool: Pool, now: Date = new Date()): Promise<number> {
  const [rows] = await pool.query<RawUserRow[]>(
    `SELECT
        u.id,
        u.registered_at,
        u.telegram_user_id,
        COALESCE(d.cnt, 0)            AS deposit_count,
        COALESCE(d.total, 0)         AS total_deposit,
        d.last_paid_at,
        l.last_login_at,
        COALESCE(t.activated, 0)     AS is_agent
      FROM bg_user u
      LEFT JOIN (
        SELECT user_id,
               COUNT(*) cnt,
               SUM(CASE WHEN currency = 'PHP' THEN amount ELSE 0 END) total,
               MAX(created_at) last_paid_at
          FROM bg_deposit_order WHERE status = 'paid' GROUP BY user_id
      ) d ON d.user_id = u.id
      LEFT JOIN (
        SELECT user_id, MAX(created_at) last_login_at FROM bg_login_log GROUP BY user_id
      ) l ON l.user_id = u.id
      LEFT JOIN bg_team_node t ON t.user_id = u.id AND t.activated = 1
     WHERE u.status = 'active'`,
  )

  if (rows.length === 0) return 0

  const values: unknown[][] = []
  for (const r of rows) {
    const lastLogin = r.last_login_at ? new Date(r.last_login_at) : null
    const lastPaid = r.last_paid_at ? new Date(r.last_paid_at) : null
    const lastActive = maxDate(lastLogin, lastPaid)
    const seg = classifySegment(
      {
        registeredAt: new Date(r.registered_at),
        lastActiveAt: lastActive,
        totalDeposit: Number(r.total_deposit),
        depositCount: Number(r.deposit_count),
        isAgent: Number(r.is_agent) === 1,
        reachableTg: r.telegram_user_id != null,
      },
      now,
    )
    values.push([
      r.id,
      seg.lifecycle,
      seg.deposited ? 1 : 0,
      seg.valueTier,
      seg.isAgent ? 1 : 0,
      seg.reachableTg ? 1 : 0,
      seg.totalDeposit,
      seg.depositCount,
      seg.lastActiveAt ? seg.lastActiveAt.toISOString().slice(0, 23).replace('T', ' ') : null,
      seg.daysSinceActive,
    ])
  }

  // 分批 upsert，避免单条 SQL 过大
  const BATCH = 500
  for (let i = 0; i < values.length; i += BATCH) {
    const chunk = values.slice(i, i + BATCH)
    await pool.query(
      `INSERT INTO bg_user_segment
         (user_id, lifecycle, deposited, value_tier, is_agent, reachable_tg, total_deposit, deposit_count, last_active_at, days_since_active)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         lifecycle = VALUES(lifecycle),
         deposited = VALUES(deposited),
         value_tier = VALUES(value_tier),
         is_agent = VALUES(is_agent),
         reachable_tg = VALUES(reachable_tg),
         total_deposit = VALUES(total_deposit),
         deposit_count = VALUES(deposit_count),
         last_active_at = VALUES(last_active_at),
         days_since_active = VALUES(days_since_active)`,
      [chunk],
    )
  }
  return values.length
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}
