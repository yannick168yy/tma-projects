import type { Redis } from 'ioredis'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { creditWalletTx } from './store/mysql-store.js'

const TICKER_SIZE = 100
const TICKER_TTL_SEC = 3600
const NAME_HEADS = 'ABCDEFGHJKLMNPRSTVW'
const NAME_TAILS = 'abcefghjklmnprstvy'

export type SpinRuleKind = 'deposit' | 'checkin'
export type CheckinTier = 'starter' | 'premium' | 'elite'
export const CHECKIN_TIERS: CheckinTier[] = ['starter', 'premium', 'elite']

export interface SpinDepositRule {
  id?: number
  kind: SpinRuleKind
  checkinTier?: CheckinTier | null
  name: string
  minDepositPhp: number
  depositAmountPhp?: number
  maxDepositPhp: number | null
  chances: number
  enabled: boolean
  sortOrder: number
  remainingChances?: number
}

export interface SpinPrize {
  id?: number
  ruleId?: number | null
  /** 奖品币种（每币种一套奖池）；amountPhp 为该币种原生金额 */
  currency: string
  name: string
  imageKey: string
  amountPhp: number
  weight: number
  turnoverX: number
  enabled: boolean
  sortOrder: number
}

export interface SpinConfig {
  enabled: boolean
  depositRules: SpinDepositRule[]
  prizes: SpinPrize[]
}

export interface SpinRecord {
  id: string
  userId: string
  displayName: string
  prizeName: string
  amountPhp: number
  currency: string
  createdAt: string
}

export interface SpinStatus {
  enabled: boolean
  remainingChances: number
  depositRules: SpinDepositRule[]
  prizes: SpinPrize[]
  recentRecords: SpinRecord[]
  tickerRecords: SpinRecord[]
}

export interface SpinDrawResult {
  recordId: string
  prizeId: number
  prizeName: string
  amountPhp: number
  currency: string
  remainingChances: number
}

function spinId(): string {
  return `SP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function ledgerId(): string {
  return `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()
}

function maskName(name: string, fallback: string): string {
  const raw = (name || fallback).trim()
  if (raw.length <= 2) return `${raw[0] ?? 'u'}***`
  return `${raw[0]}*****${raw[raw.length - 1]}`
}

function mapRule(r: RowDataPacket): SpinDepositRule {
  const amount = Number(r.min_deposit_php)
  return {
    id: Number(r.id),
    kind: r.kind === 'checkin' ? 'checkin' : 'deposit',
    checkinTier: (CHECKIN_TIERS as string[]).includes(String(r.checkin_tier)) ? (r.checkin_tier as CheckinTier) : null,
    name: String(r.name ?? ''),
    minDepositPhp: amount,
    depositAmountPhp: amount,
    maxDepositPhp: null,
    chances: 1,
    enabled: Boolean(r.enabled),
    sortOrder: Number(r.sort_order),
  }
}

function mapPrize(r: RowDataPacket): SpinPrize {
  return {
    id: Number(r.id),
    ruleId: r.rule_id == null ? null : Number(r.rule_id),
    currency: String(r.currency ?? 'PHP'),
    name: String(r.name),
    imageKey: String(r.image_key ?? 'prize-1'),
    amountPhp: Number(r.amount_php),
    weight: Number(r.weight),
    turnoverX: Number(r.turnover_x),
    enabled: Boolean(r.enabled),
    sortOrder: Number(r.sort_order),
  }
}

async function getEnabledConfig(conn: PoolConnection, currency = 'PHP'): Promise<SpinConfig> {
  const [[cfg]] = await conn.query<RowDataPacket[]>(
    `SELECT enabled FROM bg_spin_config WHERE id = 1 LIMIT 1`,
  )
  const [rules] = await conn.query<RowDataPacket[]>(
    `SELECT id, kind, checkin_tier, name, min_deposit_php, max_deposit_php, chances, enabled, sort_order
     FROM bg_spin_deposit_rule
     WHERE enabled = 1 AND kind = 'checkin'
     ORDER BY sort_order ASC, min_deposit_php ASC`,
  )
  const [prizes] = await conn.query<RowDataPacket[]>(
    `SELECT p.id, p.rule_id, p.currency, p.name, p.image_key, p.amount_php, p.weight, p.turnover_x, p.enabled, p.sort_order
     FROM bg_spin_prize p
     JOIN bg_spin_deposit_rule r ON r.id = p.rule_id AND r.kind = 'checkin'
     WHERE p.enabled = 1 AND p.currency = ?
     ORDER BY p.sort_order ASC, p.id ASC`,
    [currency],
  )
  return {
    enabled: Boolean(cfg?.enabled),
    depositRules: rules.map(mapRule),
    prizes: prizes.map(mapPrize),
  }
}

export async function getSpinConfig(env: Env, currency = 'PHP'): Promise<SpinConfig> {
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    const [[cfg]] = await conn.query<RowDataPacket[]>(
      `SELECT enabled FROM bg_spin_config WHERE id = 1 LIMIT 1`,
    )
    const [rules] = await conn.query<RowDataPacket[]>(
      `SELECT id, kind, checkin_tier, name, min_deposit_php, max_deposit_php, chances, enabled, sort_order
       FROM bg_spin_deposit_rule
       WHERE kind = 'checkin'
       ORDER BY sort_order ASC, min_deposit_php ASC`,
    )
    const [prizes] = await conn.query<RowDataPacket[]>(
      `SELECT p.id, p.rule_id, p.currency, p.name, p.image_key, p.amount_php, p.weight, p.turnover_x, p.enabled, p.sort_order
       FROM bg_spin_prize p
       JOIN bg_spin_deposit_rule r ON r.id = p.rule_id AND r.kind = 'checkin'
       WHERE p.currency = ?
       ORDER BY p.sort_order ASC, p.id ASC`,
      [currency],
    )
    return {
      enabled: Boolean(cfg?.enabled),
      depositRules: rules.map(mapRule),
      prizes: prizes.map(mapPrize),
    }
  } finally {
    conn.release()
  }
}

function validRule(rule: SpinDepositRule): boolean {
  return rule.kind === 'checkin'
}

function validPrize(prize: SpinPrize): boolean {
  return Number(prize.ruleId) > 0
    && prize.name.trim().length > 0
    && /^prize-[1-8]$/.test(prize.imageKey || '')
    && prize.amountPhp > 0
    && prize.weight > 0
    && prize.turnoverX >= 0
}

export async function saveSpinConfig(env: Env, config: SpinConfig, currency = 'PHP'): Promise<SpinConfig> {
  const pool = getMysqlPool(env)
  const rules = config.depositRules.filter(validRule).slice(0, 9)
  const prizes = config.prizes.filter(validPrize)
  if (!rules.length) throw new Error('至少需要一个有效签到档位')
  if (!prizes.length) throw new Error('至少需要一个有效奖品')
  for (const rule of rules) {
    const count = prizes.filter((p) => Number(p.ruleId) === Number(rule.id)).length
    if (rule.id && count !== 8) throw new Error(`${rule.name || '签到档位'} 必须配置 8 个奖品`)
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      `INSERT INTO bg_spin_config (id, enabled) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      [config.enabled ? 1 : 0],
    )

    const keptRuleIds: number[] = []
    for (const rule of rules) {
      const tier = rule.checkinTier && CHECKIN_TIERS.includes(rule.checkinTier) ? rule.checkinTier : null
      const name = `Check-in ${tier ? tier[0].toUpperCase() + tier.slice(1) : ''}`.trim()
      // 签到档位固定 sort 900/910/920 按 tier 排序
      const sortOrder = 900 + (tier ? CHECKIN_TIERS.indexOf(tier) * 10 : 0)
      if (rule.id) {
        keptRuleIds.push(rule.id)
        await conn.execute(
          `UPDATE bg_spin_deposit_rule
           SET kind = 'checkin', checkin_tier = ?, name = ?, min_deposit_php = 0, max_deposit_php = NULL, chances = 1, enabled = ?, sort_order = ?
           WHERE id = ?`,
          [tier, name, rule.enabled ? 1 : 0, sortOrder, rule.id],
        )
      } else {
        const [res] = await conn.execute(
          `INSERT INTO bg_spin_deposit_rule (kind, checkin_tier, name, min_deposit_php, max_deposit_php, chances, enabled, sort_order)
           VALUES ('checkin', ?, ?, 0, NULL, 1, ?, ?)`,
          [tier, name, rule.enabled ? 1 : 0, sortOrder],
        )
        keptRuleIds.push(Number((res as { insertId: number }).insertId))
      }
    }
    if (keptRuleIds.length) {
      await conn.query(
        `UPDATE bg_spin_deposit_rule SET enabled = 0 WHERE id NOT IN (?)`,
        [keptRuleIds],
      )
    }

    const keptPrizeIds: number[] = []
    for (const prize of prizes) {
      if (prize.id) {
        keptPrizeIds.push(prize.id)
        await conn.execute(
          `UPDATE bg_spin_prize
           SET rule_id = ?, name = ?, image_key = ?, amount_php = ?, weight = ?, turnover_x = ?, enabled = ?, sort_order = ?
           WHERE id = ?`,
          [prize.ruleId ?? null, prize.name.trim(), prize.imageKey, prize.amountPhp, prize.weight, prize.turnoverX, prize.enabled ? 1 : 0, prize.sortOrder, prize.id],
        )
      } else {
        const [res] = await conn.execute(
          `INSERT INTO bg_spin_prize (rule_id, currency, name, image_key, amount_php, weight, turnover_x, enabled, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [prize.ruleId ?? null, currency, prize.name.trim(), prize.imageKey, prize.amountPhp, prize.weight, prize.turnoverX, prize.enabled ? 1 : 0, prize.sortOrder],
        )
        keptPrizeIds.push(Number((res as { insertId: number }).insertId))
      }
    }
    // 只停用【本币种】未保留的奖品，避免误关其它币种奖池
    if (keptPrizeIds.length) {
      await conn.query(
        `UPDATE bg_spin_prize SET enabled = 0 WHERE currency = ? AND id NOT IN (?)`,
        [currency, keptPrizeIds],
      )
    }

    await conn.commit()
    return getSpinConfig(env, currency)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function remainingChances(conn: PoolConnection, userId: string, ruleId?: number): Promise<number> {
  const [[row]] = await conn.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(chances_total - chances_used), 0) AS total
     FROM bg_spin_chance
     WHERE user_id = ? AND chances_used < chances_total ${ruleId ? 'AND rule_id = ?' : ''}`,
    ruleId ? [userId, ruleId] : [userId],
  )
  return Number(row?.total ?? 0)
}

async function remainingByRule(conn: PoolConnection, userId: string): Promise<Map<number, number>> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT rule_id, COALESCE(SUM(chances_total - chances_used), 0) AS total
     FROM bg_spin_chance
     WHERE user_id = ? AND rule_id IS NOT NULL AND chances_used < chances_total
     GROUP BY rule_id`,
    [userId],
  )
  return new Map(rows.map((r) => [Number(r.rule_id), Number(r.total)]))
}

async function recentRecords(conn: PoolConnection, limit: number): Promise<SpinRecord[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT sr.id, sr.user_id, u.display_name, sr.prize_name, sr.amount_php, sr.currency, sr.created_at
     FROM bg_spin_record sr
     LEFT JOIN bg_user u ON u.id = sr.user_id
     ORDER BY sr.created_at DESC
     LIMIT ?`,
    [limit],
  )
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    displayName: maskName(String(r.display_name ?? ''), String(r.user_id)),
    prizeName: String(r.prize_name),
    amountPhp: Number(r.amount_php),
    currency: String(r.currency ?? 'PHP'),
    createdAt: toIso(r.created_at),
  }))
}

function tickerHourBucket(): number {
  return Math.floor(Date.now() / 3_600_000)
}

function tickerCacheKey(bucket: number): string {
  return `spin:ticker:feed:${bucket}`
}

function syntheticDisplayName(): string {
  const h = NAME_HEADS[Math.floor(Math.random() * NAME_HEADS.length)]
  const t = NAME_TAILS[Math.floor(Math.random() * NAME_TAILS.length)]
  return `${h}*****${t}`
}

function pickSyntheticPrize(prizes: SpinPrize[]): { amountPhp: number; prizeName: string; currency: string } {
  const pool = prizes.filter((p) => p.enabled && p.amountPhp > 0)
  if (!pool.length) return { amountPhp: 7.77, prizeName: '₱7.77', currency: 'PHP' }
  const total = pool.reduce((sum, prize) => sum + prize.weight, 0)
  let n = Math.random() * total
  for (const prize of pool) {
    n -= prize.weight
    if (n <= 0) return { amountPhp: prize.amountPhp, prizeName: prize.name, currency: prize.currency }
  }
  const last = pool[pool.length - 1]
  return { amountPhp: last.amountPhp, prizeName: last.name, currency: last.currency }
}

function buildRuleTicker(ruleId: number, prizes: SpinPrize[], bucket: number): SpinRecord[] {
  const now = Date.now()
  return Array.from({ length: TICKER_SIZE }, (_, i) => {
    const picked = pickSyntheticPrize(prizes)
    const ageMs = Math.floor(Math.random() * TICKER_TTL_SEC * 1000)
    return {
      id: `ST_${ruleId}_${bucket}_${i}`,
      userId: `syn_${ruleId}_${i}`,
      displayName: syntheticDisplayName(),
      prizeName: picked.prizeName,
      amountPhp: picked.amountPhp,
      currency: picked.currency,
      createdAt: new Date(now - ageMs).toISOString(),
    }
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

const memoryTickerCache = new Map<number, Record<number, SpinRecord[]>>()

async function getAllTickerFeeds(redis: Redis, config: SpinConfig): Promise<Record<number, SpinRecord[]>> {
  const bucket = tickerHourBucket()
  const key = tickerCacheKey(bucket)

  try {
    const cached = await redis.get(key)
    if (cached) return JSON.parse(cached) as Record<number, SpinRecord[]>
  } catch {
    const mem = memoryTickerCache.get(bucket)
    if (mem) return mem
  }

  const feeds: Record<number, SpinRecord[]> = {}
  for (const rule of config.depositRules) {
    if (!rule.id || !rule.enabled) continue
    const prizes = config.prizes.filter((p) => Number(p.ruleId) === Number(rule.id) && p.enabled)
    if (!prizes.length) continue
    feeds[rule.id] = buildRuleTicker(rule.id, prizes, bucket)
  }

  try {
    await redis.setex(key, TICKER_TTL_SEC, JSON.stringify(feeds))
  } catch {
    memoryTickerCache.set(bucket, feeds)
  }

  return feeds
}

async function getTickerRecords(redis: Redis, config: SpinConfig, ruleId?: number): Promise<SpinRecord[]> {
  if (!ruleId) return []
  const feeds = await getAllTickerFeeds(redis, config)
  return feeds[ruleId] ?? []
}

export async function getSpinStatus(env: Env, userId: string, redis: Redis, ruleId?: number, currency = 'PHP'): Promise<SpinStatus> {
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    const config = await getEnabledConfig(conn, currency)
    const byRule = await remainingByRule(conn, userId)
    const fullConfig = await getSpinConfig(env, currency)
    const tickerRecords = await getTickerRecords(redis, fullConfig, ruleId)
    return {
      ...config,
      depositRules: config.depositRules.map((rule) => ({
        ...rule,
        remainingChances: rule.id ? (byRule.get(rule.id) ?? 0) : 0,
      })),
      remainingChances: await remainingChances(conn, userId),
      recentRecords: await recentRecords(conn, 20),
      tickerRecords,
    }
  } finally {
    conn.release()
  }
}

// 未登录时返回公共配置（奖品/规则），所有抽奖次数为 0
export async function getPublicSpinStatus(env: Env, redis: Redis, ruleId?: number, currency = 'PHP'): Promise<SpinStatus> {
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    const config = await getEnabledConfig(conn, currency)
    const fullConfig = await getSpinConfig(env, currency)
    const tickerRecords = await getTickerRecords(redis, fullConfig, ruleId)
    return {
      ...config,
      depositRules: config.depositRules.map((rule) => ({ ...rule, remainingChances: 0 })),
      remainingChances: 0,
      recentRecords: await recentRecords(conn, 20),
      tickerRecords,
    }
  } finally {
    conn.release()
  }
}

function pickPrize(prizes: SpinPrize[]): SpinPrize {
  const total = prizes.reduce((sum, prize) => sum + prize.weight, 0)
  let n = Math.random() * total
  for (const prize of prizes) {
    n -= prize.weight
    if (n <= 0) return prize
  }
  return prizes[prizes.length - 1]
}

export async function drawSpin(env: Env, userId: string, ruleId?: number, currency = 'PHP', traceId?: string): Promise<SpinDrawResult> {
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const config = await getEnabledConfig(conn, currency)
    if (!config.enabled) throw new Error('Rewards Spin is disabled')
    if (!config.prizes.length) throw new Error('No active prize')

    const [chances] = await conn.query<RowDataPacket[]>(
      `SELECT id, rule_id, chances_total, chances_used
       FROM bg_spin_chance
       WHERE user_id = ? AND chances_used < chances_total ${ruleId ? 'AND rule_id = ?' : ''}
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE`,
      ruleId ? [userId, ruleId] : [userId],
    )
    const chance = chances[0]
    if (!chance) throw new Error('No spin chances')

    const pickedRuleId = ruleId ?? (chance.rule_id == null ? undefined : Number(chance.rule_id))
    const prizes = config.prizes.filter((prize) => prize.ruleId === pickedRuleId)
    if (!pickedRuleId || prizes.length === 0) throw new Error('No active prize for this spin')
    const prize = pickPrize(prizes)
    const recordId = spinId()
    const lgId = ledgerId()
    const prizeId = prize.id!

    await conn.execute(
      `UPDATE bg_spin_chance
       SET chances_used = chances_used + 1
       WHERE id = ? AND chances_used < chances_total`,
      [chance.id],
    )
    await conn.execute(
      `INSERT INTO bg_spin_record
         (id, user_id, chance_id, prize_id, prize_name, amount_php, currency, turnover_x, ledger_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [recordId, userId, chance.id, prizeId, prize.name, prize.amountPhp, currency, prize.turnoverX, lgId],
    )
    await creditWalletTx(conn, userId, prize.amountPhp, {
      type: 'bonus', currency, refType: 'promo', refId: recordId,
      description: `Rewards Spin ${prize.name}`, traceId: traceId ?? null, id: lgId,
    })
    if (prize.turnoverX > 0) {
      await conn.execute(
        `INSERT INTO bg_turnover_requirements
           (user_id, currency, source_type, source_ref, required_amount)
         VALUES (?, ?, 'promotion', ?, ?)`,
        [userId, currency, `spin:${recordId}`, Math.round(prize.amountPhp * prize.turnoverX * 10000) / 10000],
      )
    }

    const remaining = await remainingChances(conn, userId)
    await conn.commit()
    return {
      recordId,
      prizeId,
      prizeName: prize.name,
      amountPhp: prize.amountPhp,
      currency,
      remainingChances: remaining,
    }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

export async function listSpinRecords(
  env: Env,
  params: { page: number; pageSize: number; userId?: string },
): Promise<{ items: SpinRecord[]; total: number; page: number; pageSize: number }> {
  const pool = getMysqlPool(env)
  const offset = (params.page - 1) * params.pageSize
  const where = params.userId ? 'WHERE sr.user_id = ?' : ''
  const args = params.userId ? [params.userId] : []
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT sr.id, sr.user_id, u.display_name, sr.prize_name, sr.amount_php, sr.currency, sr.created_at
     FROM bg_spin_record sr
     LEFT JOIN bg_user u ON u.id = sr.user_id
     ${where}
     ORDER BY sr.created_at DESC
     LIMIT ? OFFSET ?`,
    [...args, params.pageSize, offset],
  )
  const [[countRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_spin_record sr ${where}`,
    args,
  )
  return {
    items: rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      displayName: String(r.display_name ?? r.user_id),
      prizeName: String(r.prize_name),
      amountPhp: Number(r.amount_php),
      currency: String(r.currency ?? 'PHP'),
      createdAt: toIso(r.created_at),
    })),
    total: Number(countRow?.total ?? 0),
    page: params.page,
    pageSize: params.pageSize,
  }
}
