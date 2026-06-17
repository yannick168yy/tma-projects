import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'

export interface SpinDepositRule {
  id?: number
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
  createdAt: string
}

export interface SpinStatus {
  enabled: boolean
  remainingChances: number
  depositRules: SpinDepositRule[]
  prizes: SpinPrize[]
  recentRecords: SpinRecord[]
}

export interface SpinDrawResult {
  recordId: string
  prizeId: number
  prizeName: string
  amountPhp: number
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
    name: String(r.name),
    imageKey: String(r.image_key ?? 'prize-1'),
    amountPhp: Number(r.amount_php),
    weight: Number(r.weight),
    turnoverX: Number(r.turnover_x),
    enabled: Boolean(r.enabled),
    sortOrder: Number(r.sort_order),
  }
}

async function getEnabledConfig(conn: PoolConnection): Promise<SpinConfig> {
  const [[cfg]] = await conn.query<RowDataPacket[]>(
    `SELECT enabled FROM bg_spin_config WHERE id = 1 LIMIT 1`,
  )
  const [rules] = await conn.query<RowDataPacket[]>(
    `SELECT id, name, min_deposit_php, max_deposit_php, chances, enabled, sort_order
     FROM bg_spin_deposit_rule
     WHERE enabled = 1
     ORDER BY sort_order ASC, min_deposit_php ASC`,
  )
  const [prizes] = await conn.query<RowDataPacket[]>(
    `SELECT id, rule_id, name, image_key, amount_php, weight, turnover_x, enabled, sort_order
     FROM bg_spin_prize
     WHERE enabled = 1
     ORDER BY sort_order ASC, id ASC`,
  )
  return {
    enabled: Boolean(cfg?.enabled),
    depositRules: rules.map(mapRule),
    prizes: prizes.map(mapPrize),
  }
}

export async function getSpinConfig(env: Env): Promise<SpinConfig> {
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    const [[cfg]] = await conn.query<RowDataPacket[]>(
      `SELECT enabled FROM bg_spin_config WHERE id = 1 LIMIT 1`,
    )
    const [rules] = await conn.query<RowDataPacket[]>(
      `SELECT id, name, min_deposit_php, max_deposit_php, chances, enabled, sort_order
       FROM bg_spin_deposit_rule
       ORDER BY sort_order ASC, min_deposit_php ASC`,
    )
    const [prizes] = await conn.query<RowDataPacket[]>(
      `SELECT id, rule_id, name, image_key, amount_php, weight, turnover_x, enabled, sort_order
       FROM bg_spin_prize
       ORDER BY sort_order ASC, id ASC`,
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
  const amount = Number(rule.depositAmountPhp ?? rule.minDepositPhp)
  return amount > 0
}

function validPrize(prize: SpinPrize): boolean {
  return Number(prize.ruleId) > 0
    && prize.name.trim().length > 0
    && /^prize-[1-8]$/.test(prize.imageKey || '')
    && prize.amountPhp > 0
    && prize.weight > 0
    && prize.turnoverX >= 0
}

export async function saveSpinConfig(env: Env, config: SpinConfig): Promise<SpinConfig> {
  const pool = getMysqlPool(env)
  const rules = config.depositRules.filter(validRule).slice(0, 6)
  const prizes = config.prizes.filter(validPrize)
  if (!rules.length) throw new Error('至少需要一个有效存款档位')
  if (!prizes.length) throw new Error('至少需要一个有效奖品')
  for (const rule of rules) {
    const count = prizes.filter((p) => Number(p.ruleId) === Number(rule.id)).length
    if (rule.id && count !== 8) throw new Error(`${rule.name || '存款级别'} 必须配置 8 个奖品`)
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
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i]
      const amount = Number(rule.depositAmountPhp ?? rule.minDepositPhp)
      const name = `Deposit ${Math.round(amount)}`
      const sortOrder = (i + 1) * 10
      if (rule.id) {
        keptRuleIds.push(rule.id)
        await conn.execute(
          `UPDATE bg_spin_deposit_rule
           SET name = ?, min_deposit_php = ?, max_deposit_php = ?, chances = ?, enabled = ?, sort_order = ?
           WHERE id = ?`,
          [name, amount, null, 1, rule.enabled ? 1 : 0, sortOrder, rule.id],
        )
      } else {
        const [res] = await conn.execute(
          `INSERT INTO bg_spin_deposit_rule (name, min_deposit_php, max_deposit_php, chances, enabled, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [name, amount, null, 1, rule.enabled ? 1 : 0, sortOrder],
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
          `INSERT INTO bg_spin_prize (rule_id, name, image_key, amount_php, weight, turnover_x, enabled, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [prize.ruleId ?? null, prize.name.trim(), prize.imageKey, prize.amountPhp, prize.weight, prize.turnoverX, prize.enabled ? 1 : 0, prize.sortOrder],
        )
        keptPrizeIds.push(Number((res as { insertId: number }).insertId))
      }
    }
    if (keptPrizeIds.length) {
      await conn.query(
        `UPDATE bg_spin_prize SET enabled = 0 WHERE id NOT IN (?)`,
        [keptPrizeIds],
      )
    }

    await conn.commit()
    return getSpinConfig(env)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

function ruleForDeposit(amount: number, rules: SpinDepositRule[]): SpinDepositRule | null {
  const matched = rules
    .filter((rule) => amount >= rule.minDepositPhp)
    .sort((a, b) => b.minDepositPhp - a.minDepositPhp || a.sortOrder - b.sortOrder)
  return matched[0] ?? null
}

export async function syncSpinChances(env: Env, userId: string): Promise<void> {
  if (!isMysqlEnabled(env)) return
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    const config = await getEnabledConfig(conn)
    if (!config.enabled || !config.depositRules.length) return

    const [orders] = await conn.query<RowDataPacket[]>(
      `SELECT o.order_id, o.amount
       FROM bg_deposit_order o
       LEFT JOIN bg_spin_chance sc ON sc.source_order_id = o.order_id
       WHERE o.user_id = ?
         AND o.status = 'paid'
         AND o.currency = 'PHP'
         AND sc.id IS NULL
       ORDER BY o.created_at ASC`,
      [userId],
    )

    for (const order of orders) {
      const amount = Number(order.amount)
      const rule = ruleForDeposit(amount, config.depositRules)
      if (!rule?.id) continue
      await conn.execute(
        `INSERT IGNORE INTO bg_spin_chance
           (user_id, source_order_id, rule_id, deposit_amount_php, chances_total)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, String(order.order_id), rule.id, amount, 1],
      )
    }
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
    `SELECT sr.id, sr.user_id, u.display_name, sr.prize_name, sr.amount_php, sr.created_at
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
    createdAt: toIso(r.created_at),
  }))
}

export async function getSpinStatus(env: Env, userId: string): Promise<SpinStatus> {
  await syncSpinChances(env, userId)
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    const config = await getEnabledConfig(conn)
    const byRule = await remainingByRule(conn, userId)
    return {
      ...config,
      depositRules: config.depositRules.map((rule) => ({
        ...rule,
        remainingChances: rule.id ? (byRule.get(rule.id) ?? 0) : 0,
      })),
      remainingChances: await remainingChances(conn, userId),
      recentRecords: await recentRecords(conn, 20),
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

export async function drawSpin(env: Env, userId: string, ruleId?: number, traceId?: string): Promise<SpinDrawResult> {
  await syncSpinChances(env, userId)
  const pool = getMysqlPool(env)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const config = await getEnabledConfig(conn)
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
         (id, user_id, chance_id, prize_id, prize_name, amount_php, turnover_x, ledger_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [recordId, userId, chance.id, prizeId, prize.name, prize.amountPhp, prize.turnoverX, lgId],
    )
    await conn.execute(
      `INSERT INTO bg_wallet (user_id, currency, available, version)
       VALUES (?, 'PHP', ?, 1)
       ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
      [userId, prize.amountPhp, prize.amountPhp],
    )
    const [[wallet]] = await conn.query<RowDataPacket[]>(
      `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = 'PHP'`,
      [userId],
    )
    await conn.execute(
      `INSERT INTO bg_wallet_ledger
         (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description, trace_id)
       VALUES (?, ?, 'PHP', 'bonus', ?, ?, 'promo', ?, ?, ?)`,
      [lgId, userId, prize.amountPhp, Number(wallet?.available ?? 0), recordId, `Rewards Spin ${prize.name}`, traceId ?? null],
    )
    if (prize.turnoverX > 0) {
      await conn.execute(
        `INSERT INTO bg_turnover_requirements
           (user_id, currency, source_type, source_ref, required_amount)
         VALUES (?, 'PHP', 'promotion', ?, ?)`,
        [userId, `spin:${recordId}`, Math.round(prize.amountPhp * prize.turnoverX * 10000) / 10000],
      )
    }

    const remaining = await remainingChances(conn, userId)
    await conn.commit()
    return {
      recordId,
      prizeId,
      prizeName: prize.name,
      amountPhp: prize.amountPhp,
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
    `SELECT sr.id, sr.user_id, u.display_name, sr.prize_name, sr.amount_php, sr.created_at
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
      createdAt: toIso(r.created_at),
    })),
    total: Number(countRow?.total ?? 0),
    page: params.page,
    pageSize: params.pageSize,
  }
}
