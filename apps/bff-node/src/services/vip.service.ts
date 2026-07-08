import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { randomBytes } from 'node:crypto'
import { getUserTotalTurnover, getLevelThresholds, resolveLevel } from './rebate.service.js'

export const MAX_VIP_LEVEL = 9

export interface VipBenefit {
  level: number
  promotionBonus: number
  weeklySalary: number
  monthlySalary: number
  negativeRebatePct: number
  retentionLine: number
}

export interface VipRewardItem {
  id: number
  level: number
  type: string
  amount: number
  currencyCode: string
  periodKey: string
  status: string
  createdAt: string | null
  paidAt: string | null
}

export interface VipProgress {
  currency: string
  totalTurnover: number
  level: number
  currentThreshold: number
  nextLevel: number | null
  nextThreshold: number | null
  benefit: VipBenefit | null
  nextBenefit: VipBenefit | null
  claimable: number
  claimableByType: { type: string; amount: number }[]
}

function vgId(): string {
  return `VG_${Date.now()}_${randomBytes(3).toString('hex')}`
}

function fmtDateTime(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19)
  return String(value).replace('T', ' ').slice(0, 19)
}

function mapBenefit(r: RowDataPacket): VipBenefit {
  return {
    level: Number(r.level),
    promotionBonus: Number(r.promotion_bonus),
    weeklySalary: Number(r.weekly_salary),
    monthlySalary: Number(r.monthly_salary),
    negativeRebatePct: Number(r.negative_rebate_pct),
    retentionLine: Number(r.retention_line),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 权益配置（后台）
// ─────────────────────────────────────────────────────────────────────────────

export async function getVipBenefits(env: Env): Promise<VipBenefit[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT level, promotion_bonus, weekly_salary, monthly_salary, negative_rebate_pct, retention_line
     FROM bg_vip_level_benefit ORDER BY level`,
  )
  return rows.map(mapBenefit)
}

export async function saveVipBenefits(env: Env, items: VipBenefit[]): Promise<void> {
  const pool = getMysqlPool(env)
  for (const it of items) {
    await pool.execute(
      `INSERT INTO bg_vip_level_benefit
         (level, promotion_bonus, weekly_salary, monthly_salary, negative_rebate_pct, retention_line)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         promotion_bonus = VALUES(promotion_bonus),
         weekly_salary = VALUES(weekly_salary),
         monthly_salary = VALUES(monthly_salary),
         negative_rebate_pct = VALUES(negative_rebate_pct),
         retention_line = VALUES(retention_line)`,
      [it.level, it.promotionBonus, it.weeklySalary, it.monthlySalary, it.negativeRebatePct, it.retentionLine],
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 晋级礼金：按已发放到的最高等级与当前等级对比，补发中间每一级的礼金（幂等）
// 懒触发：用户查看 VIP 中心时对账，保证晋级后礼金即时出现在待领取
// ─────────────────────────────────────────────────────────────────────────────

async function awardPromotionBonus(env: Env, userId: string, currentLevel: number, currency: string): Promise<void> {
  if (currentLevel <= 1) return
  const pool = getMysqlPool(env)
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(level), 1) AS awarded FROM bg_vip_reward_log
     WHERE user_id = ? AND type = 'promotion'`,
    [userId],
  )
  const awarded = Number(row?.awarded ?? 1)
  if (awarded >= currentLevel) return

  const benefits = await getVipBenefits(env)
  const byLevel = new Map(benefits.map((b) => [b.level, b]))
  for (let lv = awarded + 1; lv <= currentLevel; lv++) {
    const bonus = byLevel.get(lv)?.promotionBonus ?? 0
    if (bonus <= 0) continue
    await pool.execute(
      `INSERT IGNORE INTO bg_vip_reward_log
         (user_id, level, type, amount, currency_code, period_key, status)
       VALUES (?, ?, 'promotion', ?, ?, ?, 'pending')`,
      [userId, lv, bonus, currency, `L${lv}`],
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 用户 VIP 进度
// ─────────────────────────────────────────────────────────────────────────────

export async function getUserVipProgress(env: Env, userId: string, currency = 'PHP'): Promise<VipProgress> {
  if (!isMysqlEnabled(env)) {
    return { currency, totalTurnover: 0, level: 1, currentThreshold: 0, nextLevel: null, nextThreshold: null, benefit: null, nextBenefit: null, claimable: 0, claimableByType: [] }
  }
  const [total, thresholds, benefits] = await Promise.all([
    getUserTotalTurnover(env, userId),
    getLevelThresholds(env),
    getVipBenefits(env),
  ])
  const level = resolveLevel(thresholds, total)
  const sorted = [...thresholds].sort((a, b) => a.level - b.level)
  const current = sorted.find((t) => t.level === level)
  const next = sorted.find((t) => t.level === level + 1)
  const byLevel = new Map(benefits.map((b) => [b.level, b]))

  // 懒触发晋级礼金对账
  await awardPromotionBonus(env, userId, level, currency)

  const pool = getMysqlPool(env)
  const [[claim]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS claimable FROM bg_vip_reward_log
     WHERE user_id = ? AND currency_code = ? AND status = 'pending'
       AND (expire_at IS NULL OR expire_at > NOW(3))`,
    [userId, currency],
  )
  const [byType] = await pool.query<RowDataPacket[]>(
    `SELECT type, COALESCE(SUM(amount), 0) AS amount FROM bg_vip_reward_log
     WHERE user_id = ? AND currency_code = ? AND status = 'pending'
       AND (expire_at IS NULL OR expire_at > NOW(3))
     GROUP BY type`,
    [userId, currency],
  )

  return {
    currency,
    totalTurnover: total,
    level,
    currentThreshold: current ? current.minTurnover : 0,
    nextLevel: next ? next.level : null,
    nextThreshold: next ? next.minTurnover : null,
    benefit: byLevel.get(level) ?? null,
    nextBenefit: next ? byLevel.get(next.level) ?? null : null,
    claimable: Number(claim?.claimable ?? 0),
    claimableByType: byType.map((r) => ({ type: String(r.type), amount: Number(r.amount) })),
  }
}

export async function listVipRewards(env: Env, userId: string, limit = 50): Promise<VipRewardItem[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, level, type, amount, currency_code, period_key, status, created_at, paid_at
     FROM bg_vip_reward_log
     WHERE user_id = ?
     ORDER BY (status = 'pending') DESC, created_at DESC
     LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    level: Number(r.level),
    type: String(r.type),
    amount: Number(r.amount),
    currencyCode: String(r.currency_code),
    periodKey: String(r.period_key),
    status: String(r.status),
    createdAt: fmtDateTime(r.created_at),
    paidAt: fmtDateTime(r.paid_at),
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 领取：把用户所有待领取 VIP 礼金入账钱包并标记 paid（逐条事务 + FOR UPDATE 防重复）
// ─────────────────────────────────────────────────────────────────────────────

export async function claimVipRewards(env: Env, userId: string, currency?: string): Promise<{ claimed: number; totalAmount: number }> {
  if (!isMysqlEnabled(env)) return { claimed: 0, totalAmount: 0 }
  const pool = getMysqlPool(env)

  const where = currency
    ? "user_id = ? AND status = 'pending' AND currency_code = ? AND (expire_at IS NULL OR expire_at > NOW(3))"
    : "user_id = ? AND status = 'pending' AND (expire_at IS NULL OR expire_at > NOW(3))"
  const params = currency ? [userId, currency] : [userId]
  const [pending] = await pool.query<RowDataPacket[]>(
    `SELECT id, currency_code, amount, type, period_key FROM bg_vip_reward_log WHERE ${where}`,
    params,
  )

  let claimed = 0
  let totalAmount = 0

  for (const row of pending) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      const [[rec]] = await conn.execute<RowDataPacket[]>(
        'SELECT id, status FROM bg_vip_reward_log WHERE id = ? FOR UPDATE',
        [row.id],
      )
      if (!rec || rec.status !== 'pending') {
        await conn.rollback()
        continue
      }

      const amt = Number(row.amount)
      const cur = String(row.currency_code)

      await conn.execute(
        `INSERT INTO bg_wallet (user_id, currency, available, version)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
        [userId, cur, amt, amt],
      )
      const [[after]] = await conn.query<RowDataPacket[]>(
        'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?',
        [userId, cur],
      )
      const balAfter = Number(after?.available ?? 0)

      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, ?, 'vip_bonus', ?, ?, 'vip_bonus', ?, ?)`,
        [vgId(), userId, cur, amt, balAfter, String(row.id), `VIP ${String(row.type)} ${String(row.period_key)}`],
      )

      await conn.execute(
        "UPDATE bg_vip_reward_log SET status = 'paid', paid_at = NOW(3) WHERE id = ?",
        [row.id],
      )

      await conn.commit()
      claimed += 1
      totalAmount += amt
    } catch (err) {
      await conn.rollback()
      console.error(`[vip] claim failed record id=${row.id}:`, err)
    } finally {
      conn.release()
    }
  }

  return { claimed, totalAmount }
}

// ─────────────────────────────────────────────────────────────────────────────
// 负盈利返水（按周）：统计整周净输（Σbet − Σ(win+refund)），按用户等级返水率写 pending
// ─────────────────────────────────────────────────────────────────────────────

/** 计算周窗口（PHT 周一为起点）；includeCurrentWeek=true 结算本周至今（后台手动测试用），否则结算上一整周（定时任务用） */
function vipWeekWindow(includeCurrentWeek: boolean): { periodKey: string; startUtc: string; endUtc: string } {
  const nowMs = Date.now()
  const phtMs = nowMs + 8 * 3600 * 1000
  const pht = new Date(phtMs)
  const dow = (pht.getUTCDay() + 6) % 7 // 0=周一 .. 6=周日
  const mondayPhtMs = Date.UTC(pht.getUTCFullYear(), pht.getUTCMonth(), pht.getUTCDate() - dow, 0, 0, 0)

  let startPhtMs: number
  let endPhtMs: number
  let keyPhtMs: number
  if (includeCurrentWeek) {
    startPhtMs = mondayPhtMs
    endPhtMs = phtMs
    keyPhtMs = mondayPhtMs
  } else {
    startPhtMs = mondayPhtMs - 7 * 24 * 3600 * 1000
    endPhtMs = mondayPhtMs
    keyPhtMs = startPhtMs
  }

  const toUtcStr = (phtWallMs: number) => new Date(phtWallMs - 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  return {
    periodKey: new Date(keyPhtMs).toISOString().slice(0, 10),
    startUtc: toUtcStr(startPhtMs),
    endUtc: toUtcStr(endPhtMs),
  }
}

export async function runWeeklyNegativeRebate(
  env: Env,
  opts: { includeCurrentWeek?: boolean } = {},
): Promise<{ periodKey: string; users: number; totalAmount: number }> {
  if (!isMysqlEnabled(env)) return { periodKey: '', users: 0, totalAmount: 0 }
  const pool = getMysqlPool(env)
  const { periodKey, startUtc, endUtc } = vipWeekWindow(Boolean(opts.includeCurrentWeek))

  await pool.query(
    `INSERT INTO bg_vip_reward_log
       (user_id, level, type, amount, currency_code, period_key, status)
     SELECT
       x.user_id,
       COALESCE(ul.level, 1) AS level,
       'negative_rebate',
       ROUND(x.net_loss * COALESCE(b.negative_rebate_pct, 0) / 100, 2) AS amount,
       x.currency_code,
       ? AS period_key,
       'pending'
     FROM (
       SELECT user_id, currency_code,
         SUM(CASE WHEN bet_type = 'bet' THEN amount ELSE 0 END)
           - SUM(CASE WHEN bet_type IN ('win','refund') THEN amount ELSE 0 END) AS net_loss
       FROM bg_bet_order
       WHERE created_at >= ? AND created_at < ?
       GROUP BY user_id, currency_code
       HAVING net_loss > 0
     ) x
     LEFT JOIN (
       SELECT tt.user_id, (
         SELECT MAX(th.level) FROM bg_rebate_level_threshold th WHERE th.min_turnover <= tt.total
       ) AS level
       FROM (
         SELECT user_id, SUM(effective_amount) AS total
         FROM bg_turnover_logs WHERE is_reversed = 0 GROUP BY user_id
       ) tt
     ) ul ON ul.user_id = x.user_id
     LEFT JOIN bg_vip_level_benefit b ON b.level = COALESCE(ul.level, 1)
     WHERE ROUND(x.net_loss * COALESCE(b.negative_rebate_pct, 0) / 100, 2) > 0
     ON DUPLICATE KEY UPDATE
       amount = IF(status = 'pending', VALUES(amount), amount),
       level  = IF(status = 'pending', VALUES(level), level)`,
    [periodKey, startUtc, endUtc],
  )

  const [[agg]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT user_id) AS users, COALESCE(SUM(amount), 0) AS total
     FROM bg_vip_reward_log WHERE type = 'negative_rebate' AND period_key = ?`,
    [periodKey],
  )
  return { periodKey, users: Number(agg?.users ?? 0), totalAmount: Number(agg?.total ?? 0) }
}
