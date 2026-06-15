import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

export interface PaymentChannel {
  id: number
  name: string
  provider: string
  label: string
  enabled: boolean
  sortOrder: number
  rules: PaymentChannelRule[]
  createdAt: string
  updatedAt: string
}

export type TxType = 'deposit' | 'withdraw' | 'both'

export interface PaymentChannelRule {
  id: number
  channelId: number
  currency: string
  txType: TxType
  amountMin: number | null
  amountMax: number | null
  weight: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

type ChannelRow = RowDataPacket & {
  id: number; name: string; provider: string; label: string
  enabled: number; sort_order: number; created_at: Date; updated_at: Date
}

type RuleRow = RowDataPacket & {
  id: number; channel_id: number; currency: string; tx_type: TxType
  amount_min: string | null; amount_max: string | null
  weight: number; enabled: number; created_at: Date; updated_at: Date
}

function mapChannel(row: ChannelRow, rules: PaymentChannelRule[]): PaymentChannel {
  return {
    id: row.id, name: row.name, provider: row.provider, label: row.label,
    enabled: row.enabled === 1, sortOrder: row.sort_order,
    rules,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function mapRule(row: RuleRow): PaymentChannelRule {
  return {
    id: row.id, channelId: row.channel_id, currency: row.currency,
    txType: row.tx_type ?? 'both',
    amountMin: row.amount_min !== null ? Number(row.amount_min) : null,
    amountMax: row.amount_max !== null ? Number(row.amount_max) : null,
    weight: row.weight, enabled: row.enabled === 1,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export async function listChannels(env: Env): Promise<PaymentChannel[]> {
  const p = pool(env)
  const [channelRows] = await p.query<ChannelRow[]>(
    `SELECT * FROM payment_channels ORDER BY sort_order ASC, id ASC`
  )
  if (channelRows.length === 0) return []
  const ids = channelRows.map((r) => r.id)
  const [ruleRows] = await p.query<RuleRow[]>(
    `SELECT * FROM payment_channel_rules WHERE channel_id IN (?) ORDER BY id ASC`,
    [ids]
  )
  const ruleMap = new Map<number, PaymentChannelRule[]>()
  for (const r of ruleRows) {
    const list = ruleMap.get(r.channel_id) ?? []
    list.push(mapRule(r))
    ruleMap.set(r.channel_id, list)
  }
  return channelRows.map((r) => mapChannel(r, ruleMap.get(r.id) ?? []))
}

export async function createChannel(
  env: Env,
  data: { name: string; provider: string; label: string; enabled: boolean; sortOrder: number }
): Promise<number> {
  const [res] = await pool(env).query<ResultSetHeader>(
    `INSERT INTO payment_channels (name, provider, label, enabled, sort_order) VALUES (?, ?, ?, ?, ?)`,
    [data.name, data.provider, data.label, data.enabled ? 1 : 0, data.sortOrder]
  )
  return res.insertId
}

export async function updateChannel(
  env: Env,
  id: number,
  data: Partial<{ name: string; provider: string; label: string; enabled: boolean; sortOrder: number }>
): Promise<boolean> {
  const sets: string[] = []
  const vals: unknown[] = []
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name) }
  if (data.provider !== undefined) { sets.push('provider = ?'); vals.push(data.provider) }
  if (data.label !== undefined) { sets.push('label = ?'); vals.push(data.label) }
  if (data.enabled !== undefined) { sets.push('enabled = ?'); vals.push(data.enabled ? 1 : 0) }
  if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(data.sortOrder) }
  if (sets.length === 0) return false
  vals.push(id)
  const [res] = await pool(env).query<ResultSetHeader>(
    `UPDATE payment_channels SET ${sets.join(', ')} WHERE id = ?`,
    vals
  )
  return res.affectedRows > 0
}

export async function deleteChannel(env: Env, id: number): Promise<boolean> {
  const [res] = await pool(env).query<ResultSetHeader>(
    `DELETE FROM payment_channels WHERE id = ?`, [id]
  )
  return res.affectedRows > 0
}

export async function createRule(
  env: Env,
  channelId: number,
  data: { currency: string; txType: TxType; amountMin: number | null; amountMax: number | null; weight: number; enabled: boolean }
): Promise<number> {
  const [res] = await pool(env).query<ResultSetHeader>(
    `INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [channelId, data.currency, data.txType, data.amountMin, data.amountMax, data.weight, data.enabled ? 1 : 0]
  )
  return res.insertId
}

export async function updateRule(
  env: Env,
  id: number,
  data: Partial<{ currency: string; txType: TxType; amountMin: number | null; amountMax: number | null; weight: number; enabled: boolean }>
): Promise<boolean> {
  const sets: string[] = []
  const vals: unknown[] = []
  if (data.currency !== undefined) { sets.push('currency = ?'); vals.push(data.currency) }
  if (data.txType !== undefined) { sets.push('tx_type = ?'); vals.push(data.txType) }
  if ('amountMin' in data) { sets.push('amount_min = ?'); vals.push(data.amountMin ?? null) }
  if ('amountMax' in data) { sets.push('amount_max = ?'); vals.push(data.amountMax ?? null) }
  if (data.weight !== undefined) { sets.push('weight = ?'); vals.push(data.weight) }
  if (data.enabled !== undefined) { sets.push('enabled = ?'); vals.push(data.enabled ? 1 : 0) }
  if (sets.length === 0) return false
  vals.push(id)
  const [res] = await pool(env).query<ResultSetHeader>(
    `UPDATE payment_channel_rules SET ${sets.join(', ')} WHERE id = ?`,
    vals
  )
  return res.affectedRows > 0
}

export async function deleteRule(env: Env, id: number): Promise<boolean> {
  const [res] = await pool(env).query<ResultSetHeader>(
    `DELETE FROM payment_channel_rules WHERE id = ?`, [id]
  )
  return res.affectedRows > 0
}

type RuleWithProvider = RowDataPacket & {
  id: number; channel_id: number; currency: string; tx_type: TxType
  amount_min: string | null; amount_max: string | null
  weight: number; enabled: number
  provider: string
}

// 路由选择：给定渠道名、金额、币种和交易类型，按权重随机返回 provider
export async function resolveChannel(
  env: Env,
  channelName: string,
  txType: TxType,
  amount: number,
  currency: string
): Promise<string | null> {
  const [rows] = await pool(env).query<RuleWithProvider[]>(
    `SELECT r.*, c.provider FROM payment_channel_rules r
     JOIN payment_channels c ON c.id = r.channel_id
     WHERE r.enabled = 1 AND c.enabled = 1
       AND c.name = ?
       AND r.currency = ?
       AND (r.tx_type = ? OR r.tx_type = 'both')
       AND (r.amount_min IS NULL OR r.amount_min <= ?)
       AND (r.amount_max IS NULL OR r.amount_max >= ?)`,
    [channelName, currency, txType, amount, amount]
  )
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.weight, 0)
  let rand = Math.random() * total
  for (const r of rows) {
    rand -= r.weight
    if (rand <= 0) return r.provider
  }
  return rows[rows.length - 1].provider
}

export interface AvailableChannel {
  name: string
  label: string
  minAmount: number | null
  maxAmount: number | null
}

// 返回后台已启用且有匹配规则的唯一渠道列表（用于展示给客户端）
export async function listAvailableChannels(
  env: Env,
  txType: TxType,
  currency: string
): Promise<AvailableChannel[]> {
  type Row = RowDataPacket & {
    name: string; label: string
    amount_min: string | null; amount_max: string | null
  }
  const [rows] = await pool(env).query<Row[]>(
    `SELECT c.name, c.label,
            MIN(r.amount_min) as amount_min,
            MAX(r.amount_max) as amount_max
     FROM payment_channels c
     JOIN payment_channel_rules r ON r.channel_id = c.id
     WHERE c.enabled = 1 AND r.enabled = 1
       AND r.currency = ?
       AND (r.tx_type = ? OR r.tx_type = 'both')
     GROUP BY c.name, c.label`,
    [currency, txType]
  )
  return rows.map((r) => ({
    name: r.name,
    label: r.label,
    minAmount: r.amount_min !== null ? Number(r.amount_min) : null,
    maxAmount: r.amount_max !== null ? Number(r.amount_max) : null,
  }))
}
