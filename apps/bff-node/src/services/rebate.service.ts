import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { randomBytes } from 'node:crypto'

export interface RebateConfig {
  gameCategory: string
  ratePct: number
  maxBonus: number
  enabled: boolean
}

export interface RebateLevelConfigItem {
  level: number
  gameCategory: string
  ratePct: number
  maxBonus: number
  enabled: boolean
}

export interface RebateLevelThreshold {
  level: number
  minTurnover: number
}

export interface RebateLevelRates {
  level: number
  minTurnover: number
  rates: RebateConfig[]
}

export interface RebateLevelProgress {
  currency: string
  totalTurnover: number
  level: number
  currentThreshold: number
  nextLevel: number | null
  nextThreshold: number | null
  rates: RebateConfig[]
  claimable: number
  claimableBreakdown: RebateSummaryItem[]
}

export interface RebateSummaryItem {
  gameCategory: string
  betAmount: number
  rebateAmount: number
  ratePct: number
}

export interface RebateTierSummaryItem {
  tier: string
  betAmount: number
  rebateAmount: number
}

export interface RebateSummary {
  date: string
  status: 'estimated' | 'paid' | 'processing'
  totalBet: number
  totalRebate: number
  currency: string
  breakdown: RebateSummaryItem[]
  tierBreakdown: RebateTierSummaryItem[]
}

export interface FeaturedGame {
  id: number
  gameUuid: string
  tier: string
  sortOrder: number
  name?: string
  nameZh?: string
  provider?: string
  coverUrl?: string
}

export const MAX_LEVEL = 6

function lgId(): string {
  return `LG_${Date.now()}_${randomBytes(3).toString('hex')}`
}

function formatLedgerRebateDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

/** Cashback Games 档位承诺费率（优先于分级大类费率） */
function featuredTierRatePct(tier: string): number {
  if (tier === 'elite') return 2
  if (tier === 'pro') return 1.5
  return 0
}

/** 单行 turnover 的有效洗码费率 %：精选游戏用 elite/pro 档位，否则用分级大类配置 lc.rate_pct */
const SQL_EFFECTIVE_RATE_PCT = `
  CASE
    WHEN rfg.tier = 'elite' THEN 2.000
    WHEN rfg.tier = 'pro' THEN 1.500
    ELSE COALESCE(lc.rate_pct, 0.800)
  END
`

/** 大类当日洗码原始合计 */
const SQL_REBATE_RAW = `SUM(tl.bet_amount * (${SQL_EFFECTIVE_RATE_PCT}) / 100)`

/** 按等级·大类的每日封顶额封顶后的洗码金额（max_bonus=0 表示不封顶） */
const SQL_REBATE_CAPPED = `
  CASE
    WHEN MAX(COALESCE(lc.max_bonus, 0)) > 0
      THEN LEAST(ROUND(${SQL_REBATE_RAW}, 4), MAX(COALESCE(lc.max_bonus, 0)))
    ELSE ROUND(${SQL_REBATE_RAW}, 4)
  END
`

/** PHT = UTC+8，计算给定 Date 对象的 PHT 日期字符串 YYYY-MM-DD */
function toPhtDateStr(d: Date): string {
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return pht.toISOString().slice(0, 10)
}

export function todayPHT(): string {
  return toPhtDateStr(new Date())
}

export function yesterdayPHT(): string {
  const d = new Date()
  d.setTime(d.getTime() - 24 * 60 * 60 * 1000)
  return toPhtDateStr(d)
}

// ─────────────────────────────────────────────────────────────────────────────
// 分级费率配置（后台）
// ─────────────────────────────────────────────────────────────────────────────

export async function getLevelConfig(env: Env): Promise<RebateLevelConfigItem[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT level, game_category, rate_pct, max_bonus, enabled FROM bg_rebate_level_config ORDER BY level, game_category',
  )
  return rows.map((r) => ({
    level: Number(r.level),
    gameCategory: String(r.game_category),
    ratePct: Number(r.rate_pct),
    maxBonus: Number(r.max_bonus),
    enabled: Boolean(r.enabled),
  }))
}

export async function saveLevelConfig(env: Env, items: RebateLevelConfigItem[]): Promise<void> {
  const pool = getMysqlPool(env)
  for (const item of items) {
    await pool.execute(
      `INSERT INTO bg_rebate_level_config (level, game_category, rate_pct, max_bonus, enabled)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate_pct = VALUES(rate_pct), max_bonus = VALUES(max_bonus), enabled = VALUES(enabled)`,
      [item.level, item.gameCategory, item.ratePct, item.maxBonus ?? 0, item.enabled ? 1 : 0],
    )
  }
}

/** 指定等级的各大类费率（公开展示 / 进度接口用） */
export async function getLevelRates(env: Env, level: number): Promise<RebateConfig[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT game_category, rate_pct, max_bonus, enabled FROM bg_rebate_level_config WHERE level = ? ORDER BY game_category',
    [level],
  )
  return rows.map((r) => ({
    gameCategory: String(r.game_category),
    ratePct: Number(r.rate_pct),
    maxBonus: Number(r.max_bonus),
    enabled: Boolean(r.enabled),
  }))
}

/** 全部等级各大类费率 + 该级阈值（C 端分级卡片展示用） */
export async function getAllLevelRates(env: Env): Promise<RebateLevelRates[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT level, game_category, rate_pct, max_bonus, enabled FROM bg_rebate_level_config ORDER BY level, game_category',
  )
  const thresholds = await getLevelThresholds(env)
  const thMap = new Map(thresholds.map((t) => [t.level, t.minTurnover]))
  const byLevel = new Map<number, RebateConfig[]>()
  for (const r of rows) {
    const lv = Number(r.level)
    if (!byLevel.has(lv)) byLevel.set(lv, [])
    byLevel.get(lv)!.push({
      gameCategory: String(r.game_category),
      ratePct: Number(r.rate_pct),
      maxBonus: Number(r.max_bonus),
      enabled: Boolean(r.enabled),
    })
  }
  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, rates]) => ({ level, minTurnover: thMap.get(level) ?? 0, rates }))
}

export async function getLevelThresholds(env: Env): Promise<RebateLevelThreshold[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT level, min_turnover FROM bg_rebate_level_threshold ORDER BY level',
  )
  return rows.map((r) => ({ level: Number(r.level), minTurnover: Number(r.min_turnover) }))
}

export async function saveLevelThresholds(env: Env, items: RebateLevelThreshold[]): Promise<void> {
  const pool = getMysqlPool(env)
  for (const item of items) {
    if (item.level === 1) continue // LV1 固定 0，不可改
    await pool.execute(
      `INSERT INTO bg_rebate_level_threshold (level, min_turnover)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE min_turnover = VALUES(min_turnover)`,
      [item.level, item.minTurnover],
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 用户总流水与等级
// ─────────────────────────────────────────────────────────────────────────────

/** 用户累计有效流水（lifetime，跨币种合计；用于等级判定） */
export async function getUserTotalTurnover(env: Env, userId: string): Promise<number> {
  if (!isMysqlEnabled(env)) return 0
  const pool = getMysqlPool(env)
  const [[row]] = await pool.query<RowDataPacket[]>(
    'SELECT COALESCE(SUM(effective_amount), 0) AS total FROM bg_turnover_logs WHERE user_id = ? AND is_reversed = 0',
    [userId],
  )
  return Number(row?.total ?? 0)
}

/** 按阈值表（升序）映射总流水到等级：满足 min_turnover <= total 的最高等级，至少 LV1 */
export function resolveLevel(thresholds: RebateLevelThreshold[], total: number): number {
  let level = 1
  for (const t of thresholds) {
    if (total >= t.minTurnover && t.level > level) level = t.level
  }
  return level
}

/** 用户洗码等级进度：总流水、当前等级、下一级阈值、本级费率、可领取总额 */
export async function getUserLevelProgress(env: Env, userId: string, currency = 'PHP'): Promise<RebateLevelProgress> {
  const emptyRates: RebateConfig[] = []
  if (!isMysqlEnabled(env)) {
    return { currency, totalTurnover: 0, level: 1, currentThreshold: 0, nextLevel: null, nextThreshold: null, rates: emptyRates, claimable: 0, claimableBreakdown: [] }
  }
  const [total, thresholds] = await Promise.all([
    getUserTotalTurnover(env, userId),
    getLevelThresholds(env),
  ])
  const level = resolveLevel(thresholds, total)
  const sorted = [...thresholds].sort((a, b) => a.level - b.level)
  const current = sorted.find((t) => t.level === level)
  const next = sorted.find((t) => t.level === level + 1)
  const rates = await getLevelRates(env, level)

  const pool = getMysqlPool(env)
  const [[claim]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(rebate_amount), 0) AS claimable
     FROM bg_rebate_record
     WHERE user_id = ? AND currency_code = ? AND status = 'pending'`,
    [userId, currency],
  )
  const [claimBreakdown] = await pool.query<RowDataPacket[]>(
    `SELECT game_category, SUM(bet_amount) AS bet_amount, SUM(rebate_amount) AS rebate_amount,
            CASE
              WHEN SUM(bet_amount) > 0 THEN ROUND(SUM(rebate_amount) / SUM(bet_amount) * 100, 3)
              ELSE 0
            END AS rate_pct
     FROM bg_rebate_record
     WHERE user_id = ? AND currency_code = ? AND status = 'pending'
     GROUP BY game_category`,
    [userId, currency],
  )

  return {
    currency,
    totalTurnover: total,
    level,
    currentThreshold: current ? current.minTurnover : 0,
    nextLevel: next ? next.level : null,
    nextThreshold: next ? next.minTurnover : null,
    rates,
    claimable: Number(claim?.claimable ?? 0),
    claimableBreakdown: claimBreakdown.map((r) => ({
      gameCategory: String(r.game_category),
      betAmount: Number(r.bet_amount),
      rebateAmount: Number(r.rebate_amount),
      ratePct: Number(r.rate_pct),
    })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 洗码汇总（C 端今日估算 / 历史记录）
// ─────────────────────────────────────────────────────────────────────────────

/** 用户在精选游戏（Cashback Games）各档位的投注与洗码（档位费率 2% / 1.5%） */
async function getUserTierRebateBreakdown(
  env: Env,
  userId: string,
  phtDate: string,
  currency: string,
): Promise<RebateTierSummaryItem[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       rfg.tier,
       SUM(tl.bet_amount) AS bet_amount
     FROM bg_turnover_logs tl
     INNER JOIN bg_bet_order bo ON bo.id = tl.bet_order_id
     INNER JOIN bg_rebate_featured_game rfg
       ON rfg.game_uuid = bo.provider_id AND rfg.enabled = 1
     WHERE tl.user_id = ?
       AND tl.is_reversed = 0
       AND tl.currency = ?
       AND DATE(CONVERT_TZ(tl.created_at, '+00:00', '+08:00')) = ?
     GROUP BY rfg.tier`,
    [userId, currency, phtDate],
  )
  return rows.map((r) => {
    const tier = String(r.tier)
    const betAmount = Number(r.bet_amount)
    const ratePct = featuredTierRatePct(tier)
    return {
      tier,
      betAmount,
      rebateAmount: Math.floor(betAmount * ratePct / 100 * 10000) / 10000,
    }
  })
}

/** 查询用户指定 PHT 日期的洗码汇总（今日为估算，历史为结算记录） */
export async function getUserRebateSummary(env: Env, userId: string, phtDate: string, currency = 'PHP'): Promise<RebateSummary> {
  if (!isMysqlEnabled(env)) {
    return { date: phtDate, status: 'estimated', totalBet: 0, totalRebate: 0, currency, breakdown: [], tierBreakdown: [] }
  }
  const pool = getMysqlPool(env)
  const today = todayPHT()
  const isToday = phtDate === today

  if (isToday) {
    // 今日：按用户当前等级实时从 bg_turnover_logs 计算估算值
    const total = await getUserTotalTurnover(env, userId)
    const thresholds = await getLevelThresholds(env)
    const level = resolveLevel(thresholds, total)
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COALESCE(tl.sort_category, 'other') AS game_category,
         tl.currency,
         SUM(tl.bet_amount) AS bet_amount,
         ${SQL_REBATE_CAPPED} AS rebate_amount_capped
       FROM bg_turnover_logs tl
       LEFT JOIN bg_bet_order bo ON bo.id = tl.bet_order_id
       LEFT JOIN bg_rebate_featured_game rfg
         ON rfg.game_uuid = bo.provider_id AND rfg.enabled = 1
       LEFT JOIN bg_rebate_level_config lc
         ON lc.level = ? AND lc.game_category = COALESCE(tl.sort_category, 'other') AND lc.enabled = 1
       WHERE tl.user_id = ?
         AND tl.is_reversed = 0
         AND tl.currency = ?
         AND DATE(CONVERT_TZ(tl.created_at, '+00:00', '+08:00')) = ?
       GROUP BY COALESCE(tl.sort_category, 'other'), tl.currency`,
      [level, userId, currency, phtDate],
    )
    const breakdown: RebateSummaryItem[] = rows.map((r) => {
      const betAmt = Number(r.bet_amount)
      const rebateAmount = Math.floor(Number(r.rebate_amount_capped) * 10000) / 10000
      const ratePct = betAmt > 0
        ? Math.round(rebateAmount / betAmt * 100 * 1000) / 1000
        : 0
      return {
        gameCategory: String(r.game_category),
        betAmount: betAmt,
        rebateAmount,
        ratePct,
      }
    })
    const totalBet = breakdown.reduce((s, x) => s + x.betAmount, 0)
    const totalRebate = breakdown.reduce((s, x) => s + x.rebateAmount, 0)
    const tierBreakdown = await getUserTierRebateBreakdown(env, userId, phtDate, currency)
    return { date: phtDate, status: 'estimated', totalBet, totalRebate, currency, breakdown, tierBreakdown }
  }

  // 历史：从 bg_rebate_record 读取结算记录（pending=待领取，paid=已领取）
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT game_category, bet_amount, rebate_amount, rate_pct, status
     FROM bg_rebate_record
     WHERE user_id = ? AND date = ? AND currency_code = ?`,
    [userId, phtDate, currency],
  )
  const breakdown: RebateSummaryItem[] = rows.map((r) => ({
    gameCategory: String(r.game_category),
    betAmount: Number(r.bet_amount),
    rebateAmount: Number(r.rebate_amount),
    ratePct: Number(r.rate_pct),
  }))
  const totalBet = breakdown.reduce((s, x) => s + x.betAmount, 0)
  const totalRebate = breakdown.reduce((s, x) => s + x.rebateAmount, 0)
  const allPaid = rows.length > 0 && rows.every((r) => r.status === 'paid')
  const tierBreakdown = await getUserTierRebateBreakdown(env, userId, phtDate, currency)
  return {
    date: phtDate,
    status: allPaid ? 'paid' : rows.length > 0 ? 'processing' : 'paid',
    totalBet,
    totalRebate,
    currency,
    breakdown,
    tierBreakdown,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 精选游戏（Cashback Games）
// ─────────────────────────────────────────────────────────────────────────────

export async function getFeaturedGames(env: Env): Promise<FeaturedGame[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rfg.id, rfg.game_uuid, rfg.tier, rfg.sort_order,
            COALESCE(o.name_override, w.name_en, w.name_zh) AS name,
            w.name_zh, w.provider,
            COALESCE(o.image_override, w.icon_url) AS image_url
     FROM bg_rebate_featured_game rfg
     LEFT JOIN bg_568win_game w ON rfg.game_uuid LIKE '568win:%:%'
       AND w.game_provider_id = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(rfg.game_uuid, ':', 2), ':', -1) AS UNSIGNED)
       AND w.game_id = CAST(SUBSTRING_INDEX(rfg.game_uuid, ':', -1) AS UNSIGNED)
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = w.game_provider_id AND o.game_id = w.game_id
     WHERE rfg.enabled = 1
     ORDER BY rfg.tier, rfg.sort_order`,
  )
  return rows.map((r) => ({
    id: Number(r.id),
    gameUuid: String(r.game_uuid),
    tier: String(r.tier),
    sortOrder: Number(r.sort_order),
    name: r.name ? String(r.name) : undefined,
    nameZh: r.name_zh ? String(r.name_zh) : undefined,
    provider: r.provider ? String(r.provider) : undefined,
    coverUrl: r.image_url ? String(r.image_url) : undefined,
  }))
}

export async function addFeaturedGame(env: Env, gameUuid: string, tier: string, sortOrder = 0): Promise<void> {
  const pool = getMysqlPool(env)
  await pool.execute(
    `INSERT INTO bg_rebate_featured_game (game_uuid, tier, sort_order)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), enabled = 1`,
    [gameUuid, tier, sortOrder],
  )
}

export async function removeFeaturedGame(env: Env, id: number): Promise<void> {
  const pool = getMysqlPool(env)
  await pool.execute('DELETE FROM bg_rebate_featured_game WHERE id = ?', [id])
}

// ─────────────────────────────────────────────────────────────────────────────
// 每日结算 + 手动领取
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 每日洗码结算：计算指定 PHT 日期所有用户的洗码，写入 bg_rebate_record（status=pending=待领取）。
 * 不再自动入账，由用户在客户端手动领取（见 claimRebate）。按用户当前等级取分级费率。
 * 设计为幂等：已有 pending 记录会刷新到当前聚合值，paid 记录不再改写。
 */
export async function runDailyRebateSettlement(env: Env, date: string): Promise<{ users: number; totalRebate: number }> {
  if (!isMysqlEnabled(env)) return { users: 0, totalRebate: 0 }
  const pool = getMysqlPool(env)

  await pool.query(
    `INSERT IGNORE INTO bg_rebate_record
       (user_id, date, game_category, currency_code, bet_amount, rebate_amount, rate_pct, status)
     SELECT
       tl.user_id,
       ? AS date,
       COALESCE(tl.sort_category, 'other') AS game_category,
       tl.currency AS currency_code,
       SUM(tl.bet_amount) AS bet_amount,
       ${SQL_REBATE_CAPPED} AS rebate_amount,
       CASE
         WHEN SUM(tl.bet_amount) > 0
         THEN ROUND(${SQL_REBATE_CAPPED} / SUM(tl.bet_amount) * 100, 3)
         ELSE 0
       END AS rate_pct,
       'pending'
     FROM bg_turnover_logs tl
     LEFT JOIN bg_bet_order bo ON bo.id = tl.bet_order_id
     LEFT JOIN bg_rebate_featured_game rfg
       ON rfg.game_uuid = bo.provider_id AND rfg.enabled = 1
     LEFT JOIN (
       SELECT tt.user_id, (
         SELECT MAX(th.level) FROM bg_rebate_level_threshold th WHERE th.min_turnover <= tt.total
       ) AS level
       FROM (
         SELECT user_id, SUM(effective_amount) AS total
         FROM bg_turnover_logs WHERE is_reversed = 0 GROUP BY user_id
       ) tt
     ) ul ON ul.user_id = tl.user_id
     LEFT JOIN bg_rebate_level_config lc
       ON lc.level = COALESCE(ul.level, 1) AND lc.game_category = COALESCE(tl.sort_category, 'other') AND lc.enabled = 1
     WHERE tl.is_reversed = 0
       AND DATE(CONVERT_TZ(tl.created_at, '+00:00', '+08:00')) = ?
     GROUP BY tl.user_id, COALESCE(tl.sort_category, 'other'), tl.currency
     HAVING rebate_amount > 0
     ON DUPLICATE KEY UPDATE
       bet_amount = IF(status = 'pending', VALUES(bet_amount), bet_amount),
       rebate_amount = IF(status = 'pending', VALUES(rebate_amount), rebate_amount),
       rate_pct = IF(status = 'pending', VALUES(rate_pct), rate_pct)`,
    [date, date],
  )

  const [[agg]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT user_id) AS users, COALESCE(SUM(rebate_amount), 0) AS total
     FROM bg_rebate_record WHERE date = ?`,
    [date],
  )
  return { users: Number(agg?.users ?? 0), totalRebate: Number(agg?.total ?? 0) }
}

/**
 * 用户手动领取：把该用户所有 pending（已结算未领取）记录入账钱包并标记 paid。
 * 逐条事务，FOR UPDATE 防并发重复发放。可选按币种过滤。
 */
export async function claimRebate(env: Env, userId: string, currency?: string): Promise<{ claimed: number; totalRebate: number }> {
  if (!isMysqlEnabled(env)) return { claimed: 0, totalRebate: 0 }
  const pool = getMysqlPool(env)

  const where = currency
    ? 'user_id = ? AND status = \'pending\' AND currency_code = ?'
    : 'user_id = ? AND status = \'pending\''
  const params = currency ? [userId, currency] : [userId]
  const [pending] = await pool.query<RowDataPacket[]>(
    `SELECT id, currency_code, rebate_amount, game_category, date FROM bg_rebate_record WHERE ${where}`,
    params,
  )

  let claimed = 0
  let totalRebate = 0

  for (const row of pending) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      const [[rec]] = await conn.execute<RowDataPacket[]>(
        'SELECT id, status FROM bg_rebate_record WHERE id = ? FOR UPDATE',
        [row.id],
      )
      if (!rec || rec.status !== 'pending') {
        await conn.rollback()
        continue
      }

      const amt = Number(row.rebate_amount)
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
         VALUES (?, ?, ?, 'rebate', ?, ?, 'rebate', ?, ?)`,
        [lgId(), userId, cur, amt, balAfter, String(row.id), `${String(row.game_category)} rebate ${formatLedgerRebateDate(row.date)}`],
      )

      await conn.execute(
        'UPDATE bg_rebate_record SET status = \'paid\', paid_at = NOW(3) WHERE id = ?',
        [row.id],
      )

      await conn.commit()
      claimed += 1
      totalRebate += amt
    } catch (err) {
      await conn.rollback()
      console.error(`[rebate] claim failed record id=${row.id}:`, err)
    } finally {
      conn.release()
    }
  }

  return { claimed, totalRebate }
}
