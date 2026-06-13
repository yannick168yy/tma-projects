import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { randomBytes } from 'node:crypto'

export interface RebateConfig {
  gameCategory: string
  ratePct: number
  enabled: boolean
}

export interface RebateSummaryItem {
  gameCategory: string
  betAmount: number
  rebateAmount: number
  ratePct: number
}

export interface RebateSummary {
  date: string
  status: 'estimated' | 'paid' | 'processing'
  totalBet: number
  totalRebate: number
  currency: string
  breakdown: RebateSummaryItem[]
}

export interface FeaturedGame {
  id: number
  gameUuid: string
  tier: string
  sortOrder: number
  name?: string
  provider?: string
  coverUrl?: string
}

function lgId(): string {
  return `LG_${Date.now()}_${randomBytes(3).toString('hex')}`
}

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

export async function getRebateConfig(env: Env): Promise<RebateConfig[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT game_category, rate_pct, enabled FROM bg_rebate_config ORDER BY game_category',
  )
  return rows.map((r) => ({
    gameCategory: String(r.game_category),
    ratePct: Number(r.rate_pct),
    enabled: Boolean(r.enabled),
  }))
}

export async function saveRebateConfig(env: Env, items: { gameCategory: string; ratePct: number; enabled: boolean }[]): Promise<void> {
  const pool = getMysqlPool(env)
  for (const item of items) {
    await pool.execute(
      `INSERT INTO bg_rebate_config (game_category, rate_pct, enabled)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rate_pct = VALUES(rate_pct), enabled = VALUES(enabled)`,
      [item.gameCategory, item.ratePct, item.enabled ? 1 : 0],
    )
  }
}

/** 查询用户指定 PHT 日期的洗码汇总（今日为估算，昨日为已结算记录） */
export async function getUserRebateSummary(env: Env, userId: string, phtDate: string, currency = 'PHP'): Promise<RebateSummary> {
  if (!isMysqlEnabled(env)) {
    return { date: phtDate, status: 'estimated', totalBet: 0, totalRebate: 0, currency, breakdown: [] }
  }
  const pool = getMysqlPool(env)
  const today = todayPHT()
  const isToday = phtDate === today

  if (isToday) {
    // 今日：实时从 bg_turnover_logs 计算估算值
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COALESCE(tl.sort_category, 'other') AS game_category,
         tl.currency,
         SUM(tl.bet_amount)                  AS bet_amount,
         COALESCE(rc.rate_pct, 0.800)        AS rate_pct
       FROM bg_turnover_logs tl
       LEFT JOIN bg_rebate_config rc
         ON rc.game_category = COALESCE(tl.sort_category, 'other') AND rc.enabled = 1
       WHERE tl.user_id = ?
         AND tl.is_reversed = 0
         AND tl.currency = ?
         AND DATE(CONVERT_TZ(tl.created_at, '+00:00', '+08:00')) = ?
       GROUP BY COALESCE(tl.sort_category, 'other'), tl.currency`,
      [userId, currency, phtDate],
    )
    const breakdown: RebateSummaryItem[] = rows.map((r) => {
      const betAmt = Number(r.bet_amount)
      const ratePct = Number(r.rate_pct)
      return {
        gameCategory: String(r.game_category),
        betAmount: betAmt,
        rebateAmount: Math.floor(betAmt * ratePct / 100 * 10000) / 10000,
        ratePct,
      }
    })
    const totalBet = breakdown.reduce((s, x) => s + x.betAmount, 0)
    const totalRebate = breakdown.reduce((s, x) => s + x.rebateAmount, 0)
    return { date: phtDate, status: 'estimated', totalBet, totalRebate, currency, breakdown }
  }

  // 昨日及历史：从 bg_rebate_record 读取结算记录
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
  return {
    date: phtDate,
    status: allPaid ? 'paid' : rows.length > 0 ? 'processing' : 'paid',
    totalBet,
    totalRebate,
    currency,
    breakdown,
  }
}

export async function getFeaturedGames(env: Env): Promise<FeaturedGame[]> {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rfg.id, rfg.game_uuid, rfg.tier, rfg.sort_order,
            sg.name, sg.provider, sg.cover_url
     FROM bg_rebate_featured_game rfg
     LEFT JOIN sg_games sg ON sg.uuid = rfg.game_uuid
     WHERE rfg.enabled = 1
     ORDER BY rfg.tier, rfg.sort_order`,
  )
  return rows.map((r) => ({
    id: Number(r.id),
    gameUuid: String(r.game_uuid),
    tier: String(r.tier),
    sortOrder: Number(r.sort_order),
    name: r.name ? String(r.name) : undefined,
    provider: r.provider ? String(r.provider) : undefined,
    coverUrl: r.cover_url ? String(r.cover_url) : undefined,
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

/**
 * 每日洗码派发：计算指定 PHT 日期所有用户的洗码，写入 bg_rebate_record 并发放余额。
 * 设计为幂等：对已有 paid 记录不重复发放。
 */
export async function runDailyRebatePayout(env: Env, date: string): Promise<{ users: number; totalRebate: number }> {
  if (!isMysqlEnabled(env)) return { users: 0, totalRebate: 0 }
  const pool = getMysqlPool(env)

  // Phase 1: 计算并写入 pending 记录（INSERT IGNORE 跳过已存在记录）
  await pool.query(
    `INSERT IGNORE INTO bg_rebate_record
       (user_id, date, game_category, currency_code, bet_amount, rebate_amount, rate_pct, status)
     SELECT
       tl.user_id,
       ? AS date,
       COALESCE(tl.sort_category, 'other') AS game_category,
       tl.currency AS currency_code,
       SUM(tl.bet_amount) AS bet_amount,
       ROUND(SUM(tl.bet_amount) * COALESCE(rc.rate_pct, 0.800) / 100, 4) AS rebate_amount,
       COALESCE(rc.rate_pct, 0.800) AS rate_pct,
       'pending'
     FROM bg_turnover_logs tl
     LEFT JOIN bg_rebate_config rc
       ON rc.game_category = COALESCE(tl.sort_category, 'other') AND rc.enabled = 1
     WHERE tl.is_reversed = 0
       AND DATE(CONVERT_TZ(tl.created_at, '+00:00', '+08:00')) = ?
     GROUP BY tl.user_id, COALESCE(tl.sort_category, 'other'), tl.currency
     HAVING ROUND(SUM(tl.bet_amount) * COALESCE(rc.rate_pct, 0.800) / 100, 4) > 0`,
    [date, date],
  )

  // Phase 2: 读取所有 pending 记录
  const [pending] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, currency_code, rebate_amount, game_category
     FROM bg_rebate_record
     WHERE date = ? AND status = 'pending'`,
    [date],
  )

  let paidUsers = 0
  let totalRebate = 0
  const paidUserSet = new Set<string>()

  for (const row of pending) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      // FOR UPDATE 防止并发重复发放
      const [[rec]] = await conn.execute<RowDataPacket[]>(
        'SELECT id, status FROM bg_rebate_record WHERE id = ? FOR UPDATE',
        [row.id],
      )
      if (!rec || rec.status !== 'pending') {
        await conn.rollback()
        continue
      }

      const amt = Number(row.rebate_amount)
      const userId = String(row.user_id)
      const currency = String(row.currency_code)

      // 入账
      await conn.execute(
        `INSERT INTO bg_wallet (user_id, currency, available, version)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
        [userId, currency, amt, amt],
      )
      const [[after]] = await conn.query<RowDataPacket[]>(
        'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?',
        [userId, currency],
      )
      const balAfter = Number(after?.available ?? 0)

      // 写账变
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, ?, 'rebate', ?, ?, 'rebate', ?, ?)`,
        [lgId(), userId, currency, amt, balAfter, String(row.id), `${String(row.game_category)} rebate ${date}`],
      )

      // 标记已发放
      await conn.execute(
        'UPDATE bg_rebate_record SET status = \'paid\', paid_at = NOW(3) WHERE id = ?',
        [row.id],
      )

      await conn.commit()
      paidUserSet.add(userId)
      totalRebate += amt
    } catch (err) {
      await conn.rollback()
      console.error(`[rebate] payout failed record id=${row.id}:`, err)
    } finally {
      conn.release()
    }
  }

  paidUsers = paidUserSet.size
  return { users: paidUsers, totalRebate }
}
