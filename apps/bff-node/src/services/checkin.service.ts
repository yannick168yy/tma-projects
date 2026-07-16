import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'

// ───────────────────────── 配置（后台可配，缺省用下列常量） ─────────────────────────

export type Tier = 'starter' | 'premium' | 'elite'

/** 增强轨达标阈值：当日有存款 或 当日有效投注流水 ≥ 该值（PHP），二者其一即可 */
export const ENHANCED_TURNOVER_MIN_PHP = 100

/** 7天小周期：每天基础轨奖励 + 增强轨额外奖励（在基础之上叠加） */
export interface DayReward { base: { tier: Tier; n: number }; enh: { tier: Tier; n: number } }
export const CYCLE_REWARDS: DayReward[] = [
  { base: { tier: 'starter', n: 1 }, enh: { tier: 'premium', n: 1 } }, // day1
  { base: { tier: 'starter', n: 1 }, enh: { tier: 'premium', n: 1 } }, // day2
  { base: { tier: 'starter', n: 1 }, enh: { tier: 'premium', n: 1 } }, // day3
  { base: { tier: 'starter', n: 1 }, enh: { tier: 'premium', n: 1 } }, // day4
  { base: { tier: 'starter', n: 1 }, enh: { tier: 'premium', n: 1 } }, // day5
  { base: { tier: 'starter', n: 1 }, enh: { tier: 'premium', n: 1 } }, // day6
  { base: { tier: 'premium', n: 1 }, enh: { tier: 'elite', n: 1 } },   // day7 峰值
]

/** 30天大周期里程碑（当月累计签到天数命中即发，独立于连签） */
export interface Milestone { atDays: number; tier: Tier; n: number }
export const MILESTONES: Milestone[] = [
  { atDays: 7, tier: 'premium', n: 1 },
  { atDays: 15, tier: 'elite', n: 1 },
  { atDays: 30, tier: 'elite', n: 3 },
]

/** 小周期固定 7 天（后台只可改每天奖励，不可改天数） */
export const CYCLE_LEN = CYCLE_REWARDS.length

export interface CheckinConfig {
  enabled: boolean
  enhancedMinPhp: number
  cycle: DayReward[]        // 恰好 CYCLE_LEN 天
  milestones: Milestone[]
}

export const DEFAULT_CHECKIN_CONFIG: CheckinConfig = {
  enabled: true,
  enhancedMinPhp: ENHANCED_TURNOVER_MIN_PHP,
  cycle: CYCLE_REWARDS,
  milestones: MILESTONES,
}

const CHECKIN_CONFIG_KEY = 'checkin_config'
const ALL_TIERS: Tier[] = ['starter', 'premium', 'elite']
const clampTier = (t: unknown): Tier => (ALL_TIERS.includes(t as Tier) ? (t as Tier) : 'starter')
const clampN = (v: unknown, def = 1): number => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 0 && n <= 999 ? n : def
}

/** 校验/归一后台传入或 DB 读出的配置，任何脏数据都回落缺省，保证运行安全 */
export function sanitizeCheckinConfig(raw: unknown): CheckinConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_CHECKIN_CONFIG
  const r = raw as Partial<CheckinConfig>
  const cycleRaw = Array.isArray(r.cycle) ? r.cycle : DEFAULT_CHECKIN_CONFIG.cycle
  const cycle: DayReward[] = Array.from({ length: CYCLE_LEN }, (_, i) => {
    const c = (cycleRaw[i] ?? DEFAULT_CHECKIN_CONFIG.cycle[i]) as DayReward
    return {
      base: { tier: clampTier(c?.base?.tier), n: clampN(c?.base?.n) },
      enh: { tier: clampTier(c?.enh?.tier), n: clampN(c?.enh?.n) },
    }
  })
  const milestones: Milestone[] = (Array.isArray(r.milestones) ? r.milestones : DEFAULT_CHECKIN_CONFIG.milestones)
    .map((m) => ({ atDays: clampN((m as Milestone)?.atDays, 7), tier: clampTier((m as Milestone)?.tier), n: clampN((m as Milestone)?.n) }))
    .filter((m) => m.atDays > 0)
    .sort((a, b) => a.atDays - b.atDays)
  return {
    enabled: r.enabled !== false,
    enhancedMinPhp: Math.max(0, Number(r.enhancedMinPhp ?? DEFAULT_CHECKIN_CONFIG.enhancedMinPhp) || 0),
    cycle,
    milestones: milestones.length ? milestones : DEFAULT_CHECKIN_CONFIG.milestones,
  }
}

async function readSetting(env: Env, key: string): Promise<string | null> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    'SELECT `value` FROM bg_admin_settings WHERE `key` = ?', [key],
  )
  return rows[0] ? String(rows[0].value) : null
}

export async function getCheckinConfig(env: Env): Promise<CheckinConfig> {
  if (!isMysqlEnabled(env)) return DEFAULT_CHECKIN_CONFIG
  try {
    const raw = await readSetting(env, CHECKIN_CONFIG_KEY)
    return raw ? sanitizeCheckinConfig(JSON.parse(raw)) : DEFAULT_CHECKIN_CONFIG
  } catch { return DEFAULT_CHECKIN_CONFIG }
}

export async function saveCheckinConfig(env: Env, config: unknown): Promise<CheckinConfig> {
  const clean = sanitizeCheckinConfig(config)
  await getMysqlPool(env).execute(
    'INSERT INTO bg_admin_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [CHECKIN_CONFIG_KEY, JSON.stringify(clean)],
  )
  return clean
}

// ───────────────────────── 纯计算（可单测，不碰 DB） ─────────────────────────

/** 马尼拉(UTC+8)当天日期 YYYY-MM-DD */
export function manilaToday(nowMs = Date.now()): string {
  return new Date(nowMs + 8 * 3600_000).toISOString().slice(0, 10)
}
/** 给定马尼拉日期字符串，返回其前一天 */
export function prevDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return new Date(d.getTime() - 86400_000).toISOString().slice(0, 10)
}
/** 连签天数 → 小周期第几天 1..7 */
export function cycleDayOf(streak: number): number {
  return ((streak - 1) % CYCLE_REWARDS.length) + 1
}
/** 从上次签到日 + 连签数，推算本次签到的连签数（断签归1） */
export function nextStreak(lastDate: string | null, lastStreak: number, today: string): number {
  if (lastDate && lastDate === prevDate(today)) return lastStreak + 1
  return 1
}
/** 累计从 prev+1 到 cur 之间命中的里程碑（升序） */
export function milestonesBetween(prevMonthDays: number, curMonthDays: number, milestones: Milestone[] = MILESTONES): Milestone[] {
  return milestones.filter((m) => m.atDays > prevMonthDays && m.atDays <= curMonthDays)
}

// ───────────────────────── DB 辅助 ─────────────────────────

// 签到发放的转盘次数按 tier 进入对应的签到档位(kind='checkin' 的三档独立奖池)。
async function tierRuleIds(conn: PoolConnection | Pool): Promise<Record<Tier, number | null>> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, checkin_tier FROM bg_spin_deposit_rule WHERE kind = 'checkin' AND enabled = 1`,
  )
  const byTier = new Map<string, number>()
  let fallback: number | null = null
  for (const r of rows) {
    if (r.checkin_tier) byTier.set(String(r.checkin_tier), Number(r.id))
    if (fallback === null || Number(r.id) < fallback) fallback = Number(r.id)
  }
  const pick = (t: Tier) => byTier.get(t) ?? fallback
  return { starter: pick('starter'), premium: pick('premium'), elite: pick('elite') }
}

/** 幂等发放转盘次数：source_order_id 唯一，重复不再发 */
async function grantSpin(conn: PoolConnection, userId: string, source: string, ruleId: number | null, n: number): Promise<void> {
  if (!ruleId || n <= 0) return
  await conn.execute(
    `INSERT IGNORE INTO bg_spin_chance (user_id, source_order_id, rule_id, deposit_amount_php, chances_total)
     VALUES (?, ?, ?, 0, ?)`,
    [userId, source, ruleId, n],
  )
}

/** 当日增强轨是否达标：有存款 或 有效投注流水≥阈值（马尼拉日） */
async function enhancedEligible(conn: PoolConnection | Pool, userId: string, date: string, minPhp: number, usdRate: number): Promise<boolean> {
  const [[dep]] = await conn.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM bg_deposit_order
     WHERE user_id = ? AND status = 'paid' AND DATE(created_at + INTERVAL 8 HOUR) = ? LIMIT 1`,
    [userId, date],
  )
  if (dep) return true
  // 门槛 enhancedMinPhp 为 PHP 口径：跨币种流水折 PHP 等值（USDT/USDC 按 usdRate）再比较
  const [[bet]] = await conn.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount * (CASE WHEN currency_code IN ('USDT','USDC') THEN ? ELSE 1 END)), 0) AS turnover FROM bg_bet_order
     WHERE user_id = ? AND bet_type = 'bet' AND status = 'settled' AND DATE(created_at + INTERVAL 8 HOUR) = ?`,
    [usdRate, userId, date],
  )
  return Number(bet?.turnover ?? 0) >= minPhp
}

async function monthCount(conn: PoolConnection | Pool, userId: string, today: string): Promise<number> {
  const monthStart = `${today.slice(0, 7)}-01`
  const [[row]] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM bg_checkin_log
     WHERE user_id = ? AND checkin_date BETWEEN ? AND ?`,
    [userId, monthStart, today],
  )
  return Number(row?.cnt ?? 0)
}

async function lastLogRow(conn: PoolConnection | Pool, userId: string): Promise<{ date: string; streak: number } | null> {
  // mysql2 会把 DATE 列返成 JS Date，String() 出来不是 YYYY-MM-DD；用 DATE_FORMAT 强制成字符串
  const [[row]] = await conn.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(checkin_date, '%Y-%m-%d') AS checkin_date, streak
     FROM bg_checkin_log WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1`,
    [userId],
  )
  if (!row) return null
  return { date: String(row.checkin_date).slice(0, 10), streak: Number(row.streak) }
}

// ───────────────────────── 对外接口 ─────────────────────────

export interface CheckinStatus {
  enabled: boolean
  today: string
  todayClaimed: boolean
  todayTrack: 'base' | 'enhanced' | null
  enhancedEligibleToday: boolean
  canUpgradeToday: boolean
  streak: number
  cycleDay: number
  monthDays: number
  cycle: { day: number; base: DayReward['base']; enh: DayReward['enh'] }[]
  milestones: { atDays: number; tier: Tier; n: number; reached: boolean }[]
}

export async function getCheckinStatus(env: Env, userId: string): Promise<CheckinStatus> {
  const today = manilaToday()
  const cfg = await getCheckinConfig(env)
  const cycle = cfg.cycle.map((r, i) => ({ day: i + 1, base: r.base, enh: r.enh }))
  if (!isMysqlEnabled(env)) {
    return {
      enabled: cfg.enabled,
      today, todayClaimed: false, todayTrack: null, enhancedEligibleToday: false, canUpgradeToday: false,
      streak: 0, cycleDay: 1, monthDays: 0, cycle,
      milestones: cfg.milestones.map((m) => ({ ...m, reached: false })),
    }
  }
  const pool = getMysqlPool(env)
  const [[todayRow]] = await pool.query<RowDataPacket[]>(
    `SELECT track FROM bg_checkin_log WHERE user_id = ? AND checkin_date = ? LIMIT 1`,
    [userId, today],
  )
  const last = await lastLogRow(pool, userId)
  const monthDays = await monthCount(pool, userId, today)
  const eligible = await enhancedEligible(pool, userId, today, cfg.enhancedMinPhp, env.USDT_TO_PHP_RATE)

  const claimed = Boolean(todayRow)
  const todayTrack = (todayRow?.track as 'base' | 'enhanced' | undefined) ?? null
  // 已签当天的连签数 = last.streak（last 必为今天）；未签则预览「若现在签」的连签数
  const streak = claimed ? Number(last?.streak ?? 1) : nextStreak(last?.date ?? null, last?.streak ?? 0, today)
  const effectiveMonthDays = claimed ? monthDays : monthDays + 1

  return {
    enabled: cfg.enabled,
    today,
    todayClaimed: claimed,
    todayTrack,
    enhancedEligibleToday: eligible,
    canUpgradeToday: claimed && todayTrack === 'base' && eligible,
    streak,
    cycleDay: cycleDayOf(streak),
    monthDays: effectiveMonthDays,
    cycle,
    milestones: cfg.milestones.map((m) => ({ ...m, reached: effectiveMonthDays >= m.atDays })),
  }
}

export interface CheckinClaimResult {
  track: 'base' | 'enhanced'
  streak: number
  cycleDay: number
  monthDays: number
  upgraded: boolean
  /** 本次实际发放的转盘次数总数 */
  grantedChances: number
  milestoneHit: number
}

/**
 * 签到领取（幂等）：
 * - 首次签到当天 → 发基础轨；若已达增强条件同时发增强轨叠加 + 命中里程碑
 * - 当天已签(base) 且现在才达增强条件 → 升级补发增强轨
 * - 当天已完成 → 抛 'already claimed'
 */
export async function claimCheckin(env: Env, userId: string): Promise<CheckinClaimResult> {
  if (!isMysqlEnabled(env)) throw new Error('storage unavailable')
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    const cfg = await getCheckinConfig(env)
    if (!cfg.enabled) throw new Error('disabled')
    await conn.beginTransaction()
    const today = manilaToday()
    const tiers = await tierRuleIds(conn)
    const eligible = await enhancedEligible(conn, userId, today, cfg.enhancedMinPhp, env.USDT_TO_PHP_RATE)

    // 先按可靠的字符串比较查今天是否已签（不依赖 DATE 列回读格式）
    const [[todayRow]] = await conn.query<RowDataPacket[]>(
      `SELECT track, streak, cycle_day, month_days FROM bg_checkin_log WHERE user_id = ? AND checkin_date = ? LIMIT 1`,
      [userId, today],
    )

    if (!todayRow) {
      const last = await lastLogRow(conn, userId)
      const streak = nextStreak(last?.date ?? null, last?.streak ?? 0, today)
      const cycleDay = cycleDayOf(streak)
      const reward = cfg.cycle[cycleDay - 1]
      const prevMonth = await monthCount(conn, userId, today)
      const monthDays = prevMonth + 1
      const track: 'base' | 'enhanced' = eligible ? 'enhanced' : 'base'
      const ms = milestonesBetween(prevMonth, monthDays, cfg.milestones)
      const msHit = ms.length ? ms[ms.length - 1].atDays : 0
      const msChances = ms.reduce((s, m) => s + m.n, 0)

      // 台账 INSERT IGNORE 作为并发闸门
      const [res] = await conn.execute<import('mysql2').ResultSetHeader>(
        `INSERT IGNORE INTO bg_checkin_log
           (user_id, checkin_date, track, streak, cycle_day, month_days,
            base_rule_id, base_chances, enh_rule_id, enh_chances, milestone_days, milestone_chances)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [userId, today, track, streak, cycleDay, monthDays,
         tiers[reward.base.tier], reward.base.n,
         eligible ? tiers[reward.enh.tier] : null, eligible ? reward.enh.n : 0,
         msHit, msChances],
      )
      if (res.affectedRows > 0) {
        let granted = 0
        await grantSpin(conn, userId, `checkin:${userId}:${today}:base`, tiers[reward.base.tier], reward.base.n)
        granted += reward.base.n
        if (eligible) {
          await grantSpin(conn, userId, `checkin:${userId}:${today}:enh`, tiers[reward.enh.tier], reward.enh.n)
          granted += reward.enh.n
        }
        for (const m of ms) {
          await grantSpin(conn, userId, `checkin:${userId}:${today}:ms${m.atDays}`, tiers[m.tier], m.n)
          granted += m.n
        }
        await conn.commit()
        return { track, streak, cycleDay, monthDays, upgraded: false, grantedChances: granted, milestoneHit: msHit }
      }
      // affectedRows===0：并发下已被抢先插入，落到下面按已有记录处理（不递归）
    }

    // 当天已有记录：仅允许 base→enhanced 升级补发
    const [[row]] = await conn.query<RowDataPacket[]>(
      `SELECT track, streak, cycle_day, month_days FROM bg_checkin_log WHERE user_id = ? AND checkin_date = ? LIMIT 1`,
      [userId, today],
    )
    // 并发竞态：INSERT IGNORE 输给了另一请求，但本事务的 REPEATABLE READ 快照看不到赢家已提交的行
    if (!row) { await conn.rollback(); throw new Error('already claimed') }
    const cur = { track: String(row.track), streak: Number(row.streak), cycleDay: Number(row.cycle_day), monthDays: Number(row.month_days) }
    if (cur.track === 'base' && eligible) {
      const reward = cfg.cycle[cur.cycleDay - 1]
      await conn.execute(
        `UPDATE bg_checkin_log SET track = 'enhanced', enh_rule_id = ?, enh_chances = ?
         WHERE user_id = ? AND checkin_date = ?`,
        [tiers[reward.enh.tier], reward.enh.n, userId, today],
      )
      await grantSpin(conn, userId, `checkin:${userId}:${today}:enh`, tiers[reward.enh.tier], reward.enh.n)
      await conn.commit()
      return { track: 'enhanced', streak: cur.streak, cycleDay: cur.cycleDay, monthDays: cur.monthDays, upgraded: true, grantedChances: reward.enh.n, milestoneHit: 0 }
    }

    await conn.rollback()
    throw new Error('already claimed')
  } catch (e) {
    try { await conn.rollback() } catch { /* noop */ }
    throw e
  } finally {
    conn.release()
  }
}
