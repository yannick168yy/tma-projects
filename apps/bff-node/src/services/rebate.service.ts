import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { creditWalletTx } from './store/mysql-store.js'
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
  // 今日尚未结算的预估返利(只展示不可领)；带 TTL 缓存, 非真实时
  estimatedToday: number
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

export const MAX_LEVEL = 9

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
  if (tier === 'basic') return 1
  return 0
}

/** 单行 turnover 的有效洗码费率 %：精选游戏用 elite/pro/basic 档位，否则用分级大类配置 lc.rate_pct */
const SQL_EFFECTIVE_RATE_PCT = `
  CASE
    WHEN rfg.tier = 'elite' THEN 2.000
    WHEN rfg.tier = 'pro' THEN 1.500
    WHEN rfg.tier = 'basic' THEN 1.000
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
function toBusinessDateStr(d: Date, offsetHours = 8): string {
  const pht = new Date(d.getTime() + offsetHours * 60 * 60 * 1000)
  return pht.toISOString().slice(0, 10)
}

export function todayPHT(currency = 'PHP'): string {
  return toBusinessDateStr(new Date(), currency === 'IDR' ? 7 : 8)
}

export function yesterdayPHT(currency = 'PHP'): string {
  const d = new Date()
  d.setTime(d.getTime() - 24 * 60 * 60 * 1000)
  return toBusinessDateStr(d, currency === 'IDR' ? 7 : 8)
}

// PHT 日历日 → UTC 区间 [start, end)。created_at 存 UTC, 用区间比较可走 (user_id, created_at) 索引,
// 避免 DATE(CONVERT_TZ(created_at)) 包裹列导致全量扫描。
function phtDayUtcRange(phtDate: string, currency = 'PHP'): [Date, Date] {
  const [y, m, d] = phtDate.split('-').map(Number)
  const off = (currency === 'IDR' ? 7 : 8) * 60 * 60 * 1000
  return [new Date(Date.UTC(y, m - 1, d) - off), new Date(Date.UTC(y, m - 1, d + 1) - off)]
}

// ─────────────────────────────────────────────────────────────────────────────
// 分级费率配置（后台）
// ─────────────────────────────────────────────────────────────────────────────

export async function getLevelConfig(env: Env, currency = 'PHP'): Promise<RebateLevelConfigItem[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT level, game_category, rate_pct, max_bonus, enabled FROM bg_rebate_level_config WHERE currency = ? ORDER BY level, game_category',
    [currency],
  )
  return rows.map((r) => ({
    level: Number(r.level),
    gameCategory: String(r.game_category),
    ratePct: Number(r.rate_pct),
    maxBonus: Number(r.max_bonus),
    enabled: Boolean(r.enabled),
  }))
}

export async function saveLevelConfig(env: Env, items: RebateLevelConfigItem[], currency = 'PHP'): Promise<void> {
  const pool = getMysqlPool(env)
  for (const item of items) {
    await pool.execute(
      `INSERT INTO bg_rebate_level_config (level, game_category, currency, rate_pct, max_bonus, enabled)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate_pct = VALUES(rate_pct), max_bonus = VALUES(max_bonus), enabled = VALUES(enabled)`,
      [item.level, item.gameCategory, currency, item.ratePct, item.maxBonus ?? 0, item.enabled ? 1 : 0],
    )
  }
  // 稳定币共用一套：保存 USDT 时镜像同步 USDC
  if (currency === 'USDT') await saveLevelConfig(env, items, 'USDC')
}

/** 指定等级的各大类费率（公开展示 / 进度接口用）；按币种取（rate_pct 币种无关，max_bonus 币种相关） */
export async function getLevelRates(env: Env, level: number, currency = 'PHP'): Promise<RebateConfig[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT game_category, rate_pct, max_bonus, enabled FROM bg_rebate_level_config WHERE level = ? AND currency = ? ORDER BY game_category',
    [level, currency],
  )
  return rows.map((r) => ({
    gameCategory: String(r.game_category),
    ratePct: Number(r.rate_pct),
    maxBonus: Number(r.max_bonus),
    enabled: Boolean(r.enabled),
  }))
}

/** 全部等级各大类费率 + 该级阈值（C 端分级卡片展示用）；按币种取 */
export async function getAllLevelRates(env: Env, currency = 'PHP'): Promise<RebateLevelRates[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT level, game_category, rate_pct, max_bonus, enabled FROM bg_rebate_level_config WHERE currency = ? ORDER BY level, game_category',
    [currency],
  )
  const thresholds = await getLevelThresholds(env, currency)
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

export async function getLevelThresholds(env: Env, currency = 'PHP'): Promise<RebateLevelThreshold[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT level, min_turnover FROM bg_rebate_level_threshold WHERE currency = ? ORDER BY level',
    [currency],
  )
  return rows.map((r) => ({ level: Number(r.level), minTurnover: Number(r.min_turnover) }))
}

export async function saveLevelThresholds(env: Env, items: RebateLevelThreshold[], currency = 'PHP'): Promise<void> {
  const pool = getMysqlPool(env)
  for (const item of items) {
    if (item.level === 1) continue // LV1 固定 0，不可改
    await pool.execute(
      `INSERT INTO bg_rebate_level_threshold (level, currency, min_turnover)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE min_turnover = VALUES(min_turnover)`,
      [item.level, currency, item.minTurnover],
    )
  }
  // 稳定币共用一套：保存 USDT 时镜像同步 USDC
  if (currency === 'USDT') await saveLevelThresholds(env, items, 'USDC')
}

// ─────────────────────────────────────────────────────────────────────────────
// 用户总流水与等级
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 用户在【指定币种】的累计有效流水（lifetime，仅本币种；用于该币种账号的等级判定）。
 * 每币种当独立账号，不跨币种相加。含任务喂入的成长值 bg_user_vip_state.task_growth（该币种行）。
 */
export async function getUserTotalTurnover(env: Env, userId: string, currency: string): Promise<number> {
  if (!isMysqlEnabled(env)) return 0
  const pool = getMysqlPool(env)
  // turnover_total 由 core 写侧事务内增量维护（迁移151），单行主键查替代对 bg_turnover_logs 的全量 SUM
  // （P5 实证：全量 SUM 随数据量线性放大，3 倍数据下本接口容量 -55%）
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT turnover_total + task_growth AS total FROM bg_user_vip_state WHERE user_id = ? AND currency = ?`,
    [userId, currency],
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

/**
 * 用户在【指定币种】的权威等级：优先取 bg_user_vip_state.current_level（该币种行，支持降级），
 * 无状态行则回落到按本币种累计有效流水的阈值计算。该币种的洗码率、进度、结算均以此为准。
 */
export async function getEffectiveLevel(env: Env, userId: string, currency: string): Promise<number> {
  if (!isMysqlEnabled(env)) return 1
  const pool = getMysqlPool(env)
  const [[st]] = await pool.query<RowDataPacket[]>(
    'SELECT current_level FROM bg_user_vip_state WHERE user_id = ? AND currency = ?',
    [userId, currency],
  )
  if (st) return Number(st.current_level)
  const total = await getUserTotalTurnover(env, userId, currency)
  const thresholds = await getLevelThresholds(env, currency)
  return resolveLevel(thresholds, total)
}

/** 用户洗码等级进度：总流水、当前等级、下一级阈值、本级费率、可领取总额 */

/**
 * 今日尚未结算的预估返利。今日流水查询已走 (user_id, created_at) 索引区间(sargable),
 * 只扫今日实际条数, 故无需缓存即可实时算。
 * 双算防护：今日若被后台手动结算写入 bg_rebate_record(date=今日), 那部分已并入 claimable, 从预估里扣除。
 */
async function getEstimatedTodayRebate(env: Env, userId: string, currency: string): Promise<number> {
  const today = todayPHT(currency)
  const summary = await getUserRebateSummary(env, userId, today, currency)
  const pool = getMysqlPool(env)
  const [[settled]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(rebate_amount), 0) AS amt
     FROM bg_rebate_record
     WHERE user_id = ? AND currency_code = ? AND date = ?`,
    [userId, currency, today],
  )
  return Math.max(0, summary.totalRebate - Number(settled?.amt ?? 0))
}

export async function getUserLevelProgress(env: Env, userId: string, currency = 'PHP'): Promise<RebateLevelProgress> {
  const emptyRates: RebateConfig[] = []
  if (!isMysqlEnabled(env)) {
    return { currency, totalTurnover: 0, level: 1, currentThreshold: 0, nextLevel: null, nextThreshold: null, rates: emptyRates, claimable: 0, claimableBreakdown: [], estimatedToday: 0 }
  }
  const [total, thresholds, level, estimatedToday] = await Promise.all([
    getUserTotalTurnover(env, userId, currency),
    getLevelThresholds(env, currency),
    getEffectiveLevel(env, userId, currency),
    getEstimatedTodayRebate(env, userId, currency),
  ])
  const sorted = [...thresholds].sort((a, b) => a.level - b.level)
  const current = sorted.find((t) => t.level === level)
  const next = sorted.find((t) => t.level === level + 1)
  const rates = await getLevelRates(env, level, currency)

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
    estimatedToday,
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
       AND tl.created_at >= ? AND tl.created_at < ?
     GROUP BY rfg.tier`,
    [userId, currency, ...phtDayUtcRange(phtDate, currency)],
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
  const today = todayPHT(currency)
  const isToday = phtDate === today

  if (isToday) {
    // 今日：按用户【该币种】权威等级（支持降级）实时从 bg_turnover_logs 计算估算值
    const level = await getEffectiveLevel(env, userId, currency)
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
         ON lc.level = ? AND lc.game_category = COALESCE(tl.sort_category, 'other')
            AND lc.currency = tl.currency AND lc.enabled = 1
       WHERE tl.user_id = ?
         AND tl.is_reversed = 0
         AND tl.currency = ?
         AND tl.created_at >= ? AND tl.created_at < ?
       GROUP BY COALESCE(tl.sort_category, 'other'), tl.currency`,
      [level, userId, currency, ...phtDayUtcRange(phtDate, currency)],
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
export async function runDailyRebateSettlement(
  env: Env,
  date: string,
  opts: { currencies?: string[]; timezoneOffsetHours?: number } = {},
): Promise<{ users: number; totalRebate: number; byCurrency: Record<string, number> }> {
  if (!isMysqlEnabled(env)) return { users: 0, totalRebate: 0, byCurrency: {} }
  const pool = getMysqlPool(env)
  const currencies = opts.currencies ?? ['PHP', 'IDR', 'USDT', 'USDC']
  const timezone = `${(opts.timezoneOffsetHours ?? 8) >= 0 ? '+' : '-'}${String(Math.abs(opts.timezoneOffsetHours ?? 8)).padStart(2, '0')}:00`

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
       SELECT tt.user_id, tt.currency, (
         SELECT MAX(th.level) FROM bg_rebate_level_threshold th
         WHERE th.currency = tt.currency AND th.min_turnover <= tt.total
       ) AS level
       FROM (
         -- 取迁移151的累加列而非对 bg_turnover_logs 全表 SUM：该表日增约3万行且此处无时间下界，
         -- 半年后就是几百万行的全表聚合。turnover_total 由 core 在同事务内增量维护，
         -- 生产实测 1180 个(用户,币种)与全表 SUM 完全一致（最大差 0.0000）。
         -- turnover_total > 0 不可省：vip_state 里还有 251 行是无流水的(用户,币种)，
         -- 不过滤会让本子查询多出这些行；虽然这里是 LEFT JOIN 不受影响，但同样的写法在
         -- vip.service 的生日礼金是 INNER JOIN，多出的行会变成给没玩过的币种发钱。
         SELECT user_id, currency, turnover_total AS total
         FROM bg_user_vip_state WHERE turnover_total > 0
       ) tt
     ) ul ON ul.user_id = tl.user_id AND ul.currency = tl.currency
     LEFT JOIN bg_user_vip_state vs ON vs.user_id = tl.user_id AND vs.currency = tl.currency
     LEFT JOIN bg_rebate_level_config lc
       ON lc.level = COALESCE(vs.current_level, ul.level, 1) AND lc.game_category = COALESCE(tl.sort_category, 'other')
          AND lc.currency = tl.currency AND lc.enabled = 1
     WHERE tl.is_reversed = 0
       AND DATE(CONVERT_TZ(tl.created_at, '+00:00', ?)) = ?
       AND tl.currency IN (${currencies.map(() => '?').join(', ')})
     GROUP BY tl.user_id, COALESCE(tl.sort_category, 'other'), tl.currency
     HAVING rebate_amount > 0
     ON DUPLICATE KEY UPDATE
       bet_amount = IF(status = 'pending', VALUES(bet_amount), bet_amount),
       rebate_amount = IF(status = 'pending', VALUES(rebate_amount), rebate_amount),
       rate_pct = IF(status = 'pending', VALUES(rate_pct), rate_pct)`,
    [date, timezone, date, ...currencies],
  )

  const [[agg]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT user_id) AS users, COALESCE(SUM(rebate_amount), 0) AS total
     FROM bg_rebate_record WHERE date = ? AND currency_code IN (${currencies.map(() => '?').join(', ')})`,
    [date, ...currencies],
  )
  const [currencyRows] = await pool.query<RowDataPacket[]>(
    `SELECT currency_code, COALESCE(SUM(rebate_amount), 0) AS total
     FROM bg_rebate_record WHERE date = ? AND currency_code IN (${currencies.map(() => '?').join(', ')})
     GROUP BY currency_code`,
    [date, ...currencies],
  )
  return {
    users: Number(agg?.users ?? 0),
    totalRebate: Number(agg?.total ?? 0),
    byCurrency: Object.fromEntries(currencyRows.map((row) => [String(row.currency_code), Number(row.total ?? 0)])),
  }
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

      await creditWalletTx(conn, userId, amt, {
        type: 'rebate', currency: cur, refType: 'rebate', refId: String(row.id),
        description: `${String(row.game_category)} rebate ${formatLedgerRebateDate(row.date)}`,
        id: lgId(),
      })

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
