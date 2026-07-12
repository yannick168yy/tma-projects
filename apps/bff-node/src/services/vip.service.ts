import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { creditWalletTx } from './store/mysql-store.js'
import { randomBytes } from 'node:crypto'
import { getUserTotalTurnover, getLevelThresholds, resolveLevel } from './rebate.service.js'

export const MAX_VIP_LEVEL = 9

export interface VipBenefit {
  level: number
  promotionBonus: number
  weeklySalary: number
  monthlySalary: number
  birthdayBonus: number
  negativeRebatePct: number
  retentionLine: number
  withdrawDailyLimit: number
  withdrawDailyCount: number
}

/** 专属客服起始等级（VIP6+ 享专属客服，纯展示/前端判定用） */
export const PRIORITY_SUPPORT_LEVEL = 6

/** 结算/发放类礼金统一以平台基准币种入账 */
const BASE_CURRENCY = 'PHP'

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
  awardedLevel: number
  demoted: boolean
  quarterTurnover: number
  retentionLine: number
  prioritySupport: boolean
  birthdaySet: boolean
}

export interface VipLevelConfig extends VipBenefit {
  minTurnover: number
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
    birthdayBonus: Number(r.birthday_bonus),
    negativeRebatePct: Number(r.negative_rebate_pct),
    retentionLine: Number(r.retention_line),
    withdrawDailyLimit: Number(r.withdraw_daily_limit),
    withdrawDailyCount: Number(r.withdraw_daily_count),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 权益配置（后台）
// ─────────────────────────────────────────────────────────────────────────────

export async function getVipBenefits(env: Env): Promise<VipBenefit[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT level, promotion_bonus, weekly_salary, monthly_salary, birthday_bonus,
            negative_rebate_pct, retention_line, withdraw_daily_limit, withdraw_daily_count
     FROM bg_vip_level_benefit ORDER BY level`,
  )
  return rows.map(mapBenefit)
}

export async function saveVipBenefits(env: Env, items: VipBenefit[]): Promise<void> {
  const pool = getMysqlPool(env)
  for (const it of items) {
    await pool.execute(
      `INSERT INTO bg_vip_level_benefit
         (level, promotion_bonus, weekly_salary, monthly_salary, birthday_bonus,
          negative_rebate_pct, retention_line, withdraw_daily_limit, withdraw_daily_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         promotion_bonus = VALUES(promotion_bonus),
         weekly_salary = VALUES(weekly_salary),
         monthly_salary = VALUES(monthly_salary),
         birthday_bonus = VALUES(birthday_bonus),
         negative_rebate_pct = VALUES(negative_rebate_pct),
         retention_line = VALUES(retention_line),
         withdraw_daily_limit = VALUES(withdraw_daily_limit),
         withdraw_daily_count = VALUES(withdraw_daily_count)`,
      [it.level, it.promotionBonus, it.weeklySalary, it.monthlySalary, it.birthdayBonus,
       it.negativeRebatePct, it.retentionLine, it.withdrawDailyLimit, it.withdrawDailyCount],
    )
  }
}

export async function getVipLevelConfig(env: Env): Promise<VipLevelConfig[]> {
  if (!isMysqlEnabled(env)) return []
  const [thresholds, benefits] = await Promise.all([
    getLevelThresholds(env),
    getVipBenefits(env),
  ])
  const thresholdMap = new Map(thresholds.map((t) => [t.level, t.minTurnover]))
  return benefits
    .map((b) => ({ ...b, minTurnover: thresholdMap.get(b.level) ?? 0 }))
    .sort((a, b) => a.level - b.level)
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
    return { currency, totalTurnover: 0, level: 1, currentThreshold: 0, nextLevel: null, nextThreshold: null, benefit: null, nextBenefit: null, claimable: 0, claimableByType: [], awardedLevel: 1, demoted: false, quarterTurnover: 0, retentionLine: 0, prioritySupport: false, birthdaySet: false }
  }
  const [total, thresholds, benefits] = await Promise.all([
    getUserTotalTurnover(env, userId),
    getLevelThresholds(env),
    getVipBenefits(env),
  ])
  // 权威等级来自状态机（支持降级）；懒触发建行 + 爬升对账
  const state = await reconcileVipState(env, userId, total)
  const level = state.currentLevel
  const sorted = [...thresholds].sort((a, b) => a.level - b.level)
  const current = sorted.find((t) => t.level === level)
  const next = sorted.find((t) => t.level === level + 1)
  const byLevel = new Map(benefits.map((b) => [b.level, b]))

  // 懒触发晋级礼金对账（上限为历史最高等级）
  await awardPromotionBonus(env, userId, state.awardedLevel, currency)

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
  const birthdaySet = await ensureBirthdayFromKyc(env, userId)

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
    awardedLevel: state.awardedLevel,
    demoted: state.currentLevel < state.awardedLevel,
    quarterTurnover: Math.max(0, total - state.quarterStartTurnover),
    retentionLine: byLevel.get(level)?.retentionLine ?? 0,
    prioritySupport: level >= PRIORITY_SUPPORT_LEVEL,
    birthdaySet,
  }
}

/**
 * 生日只来自 KYC 证件（Gemini 识别的 dob），不接受用户手输。
 * 已设置返回 true；未设置且 KYC 已通过则从 gemini_result 提取 dob 懒回填（覆盖历史已认证用户）。
 */
export async function ensureBirthdayFromKyc(env: Env, userId: string): Promise<boolean> {
  if (!isMysqlEnabled(env)) return false
  const pool = getMysqlPool(env)
  const [[u]] = await pool.query<RowDataPacket[]>('SELECT birthday FROM bg_user WHERE id = ?', [userId])
  if (!u) return false
  if (u.birthday != null) return true
  const [[kyc]] = await pool.query<RowDataPacket[]>(
    'SELECT status, gemini_result FROM bg_kyc WHERE user_id = ? LIMIT 1', [userId],
  )
  if (!kyc || kyc.status !== 'approved') return false
  let dob = ''
  try {
    const g = typeof kyc.gemini_result === 'string' ? JSON.parse(kyc.gemini_result) : kyc.gemini_result
    const raw = (g as { document?: { dob?: unknown } } | null)?.document?.dob
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) dob = raw.slice(0, 10)
  } catch { /* gemini_result 脏数据时不回填 */ }
  if (!dob) return false
  const res = await setUserBirthday(env, userId, dob)
  return res.ok || res.reason === 'already_set'
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

      await creditWalletTx(conn, userId, amt, {
        type: 'vip_bonus', currency: cur, refType: 'vip_bonus', refId: String(row.id),
        description: `VIP ${String(row.type)} ${String(row.period_key)}`,
        id: vgId(),
      })

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
       COALESCE(vs.current_level, ul.level, 1) AS level,
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
     LEFT JOIN bg_user_vip_state vs ON vs.user_id = x.user_id
     LEFT JOIN bg_vip_level_benefit b ON b.level = COALESCE(vs.current_level, ul.level, 1)
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

// ─────────────────────────────────────────────────────────────────────────────
// 等级状态机（硬降级模型）
//   current_level = 权威等级（可降级）；awarded_level = 历史最高（累计流水单调爬升）
//   无状态行的老用户在各处按等级计算时 COALESCE 回落到阈值计算，行为不变
// ─────────────────────────────────────────────────────────────────────────────

/** 某用户累计有效流水 → 等级 的 SQL 子查询（产出列 user_id, lvl）
 *  含任务喂入的成长值 task_growth（等效有效流水加速升级）；保级/降级 delta 不含成长值，见 runQuarterlyRetention。 */
const SQL_USER_LEVEL = `
  SELECT tt.user_id, (
    SELECT MAX(th.level) FROM bg_rebate_level_threshold th
    WHERE th.min_turnover <= tt.cum + COALESCE(vs.task_growth, 0)
  ) AS lvl
  FROM (SELECT user_id, SUM(effective_amount) AS cum FROM bg_turnover_logs WHERE is_reversed = 0 GROUP BY user_id) tt
  LEFT JOIN bg_user_vip_state vs ON vs.user_id = tt.user_id
`

/** 当前保级考核季度键（PHT），如 2026-Q3 */
function currentQuarterKey(atMs?: number): string {
  const d = new Date((atMs ?? Date.now()) + 8 * 3600 * 1000)
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `${d.getUTCFullYear()}-Q${q}`
}

/** 单用户对账：建行 + 累计爬升（达到历史新高时当前等级跟进，覆盖过去的降级） */
export async function reconcileVipState(
  env: Env,
  userId: string,
  cumulative?: number,
): Promise<{ currentLevel: number; awardedLevel: number; quarterStartTurnover: number }> {
  const pool = getMysqlPool(env)
  const total = cumulative ?? (await getUserTotalTurnover(env, userId))
  const thresholds = await getLevelThresholds(env)
  const earned = resolveLevel(thresholds, total)

  const [[row]] = await pool.query<RowDataPacket[]>(
    'SELECT current_level, awarded_level, quarter_start_turnover FROM bg_user_vip_state WHERE user_id = ?',
    [userId],
  )
  if (!row) {
    await pool.execute(
      `INSERT IGNORE INTO bg_user_vip_state (user_id, current_level, awarded_level, quarter_key, quarter_start_turnover)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, earned, earned, currentQuarterKey(), total],
    )
    return { currentLevel: earned, awardedLevel: earned, quarterStartTurnover: total }
  }
  let currentLevel = Number(row.current_level)
  let awardedLevel = Number(row.awarded_level)
  const quarterStart = Number(row.quarter_start_turnover)
  if (earned > awardedLevel) {
    awardedLevel = earned
    currentLevel = earned
    await pool.execute(
      'UPDATE bg_user_vip_state SET current_level = ?, awarded_level = ? WHERE user_id = ?',
      [currentLevel, awardedLevel, userId],
    )
  }
  return { currentLevel, awardedLevel, quarterStartTurnover: quarterStart }
}

/** 批量建行 + 爬升（每日定时对账全量用户） */
export async function ensureAndClimbVipStates(env: Env): Promise<void> {
  if (!isMysqlEnabled(env)) return
  const pool = getMysqlPool(env)
  await pool.query(
    `INSERT IGNORE INTO bg_user_vip_state (user_id, current_level, awarded_level, quarter_key, quarter_start_turnover)
     SELECT s.user_id, COALESCE(s.lvl, 1), COALESCE(s.lvl, 1), ?, s.cum
     FROM (
       SELECT tt.user_id, tt.cum, (
         SELECT MAX(th.level) FROM bg_rebate_level_threshold th WHERE th.min_turnover <= tt.cum
       ) AS lvl
       FROM (SELECT user_id, SUM(effective_amount) AS cum FROM bg_turnover_logs WHERE is_reversed = 0 GROUP BY user_id) tt
     ) s`,
    [currentQuarterKey()],
  )
  await pool.query(
    `UPDATE bg_user_vip_state vs
     JOIN (${SQL_USER_LEVEL}) e ON e.user_id = vs.user_id
     SET vs.current_level = IF(e.lvl > vs.awarded_level, e.lvl, vs.current_level),
         vs.awarded_level = GREATEST(vs.awarded_level, e.lvl)
     WHERE e.lvl > vs.awarded_level`,
  )
}

/** 季度保级考核：达标不足降 1 级；活跃且低于历史最高则回升 1 级；每季度每用户只处理一次（quarter_key 守卫） */
export async function runQuarterlyRetention(env: Env): Promise<{ quarterKey: string; processed: number; demoted: number }> {
  if (!isMysqlEnabled(env)) return { quarterKey: '', processed: 0, demoted: 0 }
  const pool = getMysqlPool(env)
  const qkey = currentQuarterKey()

  const [[before]] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM bg_user_vip_state WHERE quarter_key <> ?', [qkey],
  )
  // 最多降一级：仅当 current_level 仍在历史最高（awarded_level）时才可降，降到 awarded_level-1 即触底，不再继续下掉
  const [demoteAgg] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM bg_user_vip_state vs
     LEFT JOIN (SELECT user_id, SUM(effective_amount) AS cum FROM bg_turnover_logs WHERE is_reversed = 0 GROUP BY user_id) tt ON tt.user_id = vs.user_id
     LEFT JOIN bg_vip_level_benefit b ON b.level = vs.current_level
     WHERE vs.quarter_key <> ? AND vs.current_level > 1 AND vs.current_level >= vs.awarded_level
       AND (COALESCE(tt.cum, 0) - vs.quarter_start_turnover) < COALESCE(b.retention_line, 0)`,
    [qkey],
  )
  await pool.query(
    `UPDATE bg_user_vip_state vs
     LEFT JOIN (SELECT user_id, SUM(effective_amount) AS cum FROM bg_turnover_logs WHERE is_reversed = 0 GROUP BY user_id) tt ON tt.user_id = vs.user_id
     LEFT JOIN bg_vip_level_benefit b ON b.level = vs.current_level
     SET vs.current_level = CASE
           WHEN vs.current_level > 1
                AND vs.current_level >= vs.awarded_level
                AND (COALESCE(tt.cum, 0) - vs.quarter_start_turnover) < COALESCE(b.retention_line, 0)
             THEN vs.current_level - 1
           WHEN vs.current_level < vs.awarded_level
                AND (COALESCE(tt.cum, 0) - vs.quarter_start_turnover) > 0
                AND (COALESCE(tt.cum, 0) - vs.quarter_start_turnover) >= COALESCE(b.retention_line, 0)
             THEN vs.current_level + 1
           ELSE vs.current_level END,
         vs.quarter_start_turnover = COALESCE(tt.cum, vs.quarter_start_turnover),
         vs.quarter_key = ?
     WHERE vs.quarter_key <> ?`,
    [qkey, qkey],
  )
  return { quarterKey: qkey, processed: Number(before?.n ?? 0), demoted: Number(demoteAgg?.[0]?.n ?? 0) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 周俸 / 月俸（按等级固定发放，需当期有效流水达门槛，限时手动领取）
// 门槛 = 该级保级线折算到当期：周俸 retention_line/13（季≈13周）、月俸 retention_line/3，防低流水躺领
// ─────────────────────────────────────────────────────────────────────────────

/** 计算月窗口（PHT 月初为起点）；includeCurrentMonth=true 结算本月至今，否则结算上一整月 */
function vipMonthWindow(includeCurrentMonth: boolean): { periodKey: string; startUtc: string; endUtc: string } {
  const phtMs = Date.now() + 8 * 3600 * 1000
  const d = new Date(phtMs)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const firstThis = Date.UTC(y, m, 1, 0, 0, 0)
  let startPht: number
  let endPht: number
  let keyMs: number
  if (includeCurrentMonth) {
    startPht = firstThis
    endPht = phtMs
    keyMs = firstThis
  } else {
    const prevY = m === 0 ? y - 1 : y
    const prevM = m === 0 ? 11 : m - 1
    startPht = Date.UTC(prevY, prevM, 1, 0, 0, 0)
    endPht = firstThis
    keyMs = startPht
  }
  const toUtcStr = (phtWallMs: number) => new Date(phtWallMs - 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const k = new Date(keyMs)
  return {
    periodKey: `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}`,
    startUtc: toUtcStr(startPht),
    endUtc: toUtcStr(endPht),
  }
}

async function runSalary(
  env: Env,
  kind: 'weekly' | 'monthly',
  window: { periodKey: string; startUtc: string; endUtc: string },
  expireDays: number,
): Promise<{ periodKey: string; users: number; totalAmount: number }> {
  const pool = getMysqlPool(env)
  const amountCol = kind === 'weekly' ? 'b.weekly_salary' : 'b.monthly_salary'
  const retentionDivisor = kind === 'weekly' ? 13 : 3
  await pool.query(
    `INSERT INTO bg_vip_reward_log
       (user_id, level, type, amount, currency_code, period_key, status, expire_at)
     SELECT act.user_id, COALESCE(vs.current_level, thr.lvl, 1) AS lvl, ?, ${amountCol}, ?, ?, 'pending',
            DATE_ADD(NOW(3), INTERVAL ? DAY)
     FROM (SELECT user_id, SUM(effective_amount) AS period_turnover
             FROM bg_turnover_logs WHERE is_reversed = 0 AND created_at >= ? AND created_at < ?
             GROUP BY user_id) act
     LEFT JOIN bg_user_vip_state vs ON vs.user_id = act.user_id
     LEFT JOIN (${SQL_USER_LEVEL}) thr ON thr.user_id = act.user_id
     JOIN bg_vip_level_benefit b ON b.level = COALESCE(vs.current_level, thr.lvl, 1)
     WHERE ${amountCol} > 0 AND act.period_turnover >= b.retention_line / ?
     ON DUPLICATE KEY UPDATE amount = IF(status = 'pending', VALUES(amount), amount)`,
    [kind, BASE_CURRENCY, window.periodKey, expireDays, window.startUtc, window.endUtc, retentionDivisor],
  )
  const [[agg]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT user_id) AS users, COALESCE(SUM(amount), 0) AS total
     FROM bg_vip_reward_log WHERE type = ? AND period_key = ?`,
    [kind, window.periodKey],
  )
  return { periodKey: window.periodKey, users: Number(agg?.users ?? 0), totalAmount: Number(agg?.total ?? 0) }
}

export async function runWeeklySalary(env: Env, opts: { includeCurrentWeek?: boolean } = {}) {
  if (!isMysqlEnabled(env)) return { periodKey: '', users: 0, totalAmount: 0 }
  return runSalary(env, 'weekly', vipWeekWindow(Boolean(opts.includeCurrentWeek)), 7)
}

export async function runMonthlySalary(env: Env, opts: { includeCurrentMonth?: boolean } = {}) {
  if (!isMysqlEnabled(env)) return { periodKey: '', users: 0, totalAmount: 0 }
  return runSalary(env, 'monthly', vipMonthWindow(Boolean(opts.includeCurrentMonth)), 14)
}

// ─────────────────────────────────────────────────────────────────────────────
// 生日礼金（当日生日 + 该级 birthday_bonus，每年一次）
// ─────────────────────────────────────────────────────────────────────────────

export async function runBirthdayBonus(env: Env): Promise<{ users: number; totalAmount: number }> {
  if (!isMysqlEnabled(env)) return { users: 0, totalAmount: 0 }
  const pool = getMysqlPool(env)
  const pht = new Date(Date.now() + 8 * 3600 * 1000)
  const mmdd = `${String(pht.getUTCMonth() + 1).padStart(2, '0')}-${String(pht.getUTCDate()).padStart(2, '0')}`
  const yearKey = String(pht.getUTCFullYear())

  await pool.query(
    `INSERT INTO bg_vip_reward_log
       (user_id, level, type, amount, currency_code, period_key, status)
     SELECT u.id, COALESCE(vs.current_level, thr.lvl, 1), 'birthday', b.birthday_bonus, ?, ?, 'pending'
     FROM bg_user u
     LEFT JOIN bg_user_vip_state vs ON vs.user_id = u.id
     LEFT JOIN (${SQL_USER_LEVEL}) thr ON thr.user_id = u.id
     JOIN bg_vip_level_benefit b ON b.level = COALESCE(vs.current_level, thr.lvl, 1)
     WHERE u.birthday IS NOT NULL
       AND DATE_FORMAT(u.birthday, '%m-%d') = ?
       AND b.birthday_bonus > 0
     ON DUPLICATE KEY UPDATE amount = IF(status = 'pending', VALUES(amount), amount)`,
    [BASE_CURRENCY, yearKey, mmdd],
  )
  const [[agg]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT user_id) AS users, COALESCE(SUM(amount), 0) AS total
     FROM bg_vip_reward_log WHERE type = 'birthday' AND period_key = ?`,
    [yearKey],
  )
  return { users: Number(agg?.users ?? 0), totalAmount: Number(agg?.total ?? 0) }
}

/** 设置生日（一次性，设置后不可改；靠 birthday IS NULL 守卫幂等） */
export async function setUserBirthday(env: Env, userId: string, birthday: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isMysqlEnabled(env)) return { ok: false, reason: 'unavailable' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return { ok: false, reason: 'invalid' }
  const d = new Date(`${birthday}T00:00:00Z`)
  if (isNaN(d.getTime())) return { ok: false, reason: 'invalid' }
  const pool = getMysqlPool(env)
  const [res] = await pool.execute<ResultSetHeader>(
    'UPDATE bg_user SET birthday = ? WHERE id = ? AND birthday IS NULL',
    [birthday, userId],
  )
  if (res.affectedRows === 0) return { ok: false, reason: 'already_set' }
  return { ok: true }
}
