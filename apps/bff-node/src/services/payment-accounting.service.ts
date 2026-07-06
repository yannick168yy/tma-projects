import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { getBalance as yfpayGetBalance } from './yfpay.service.js'
import { getBalance as beepayGetBalance } from './beepay.service.js'

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

// 已知支付服务商（订单表无 provider 列，需从 channel 前缀解析）
const PROVIDER_LABELS: Record<string, string> = {
  yfpay: 'YFPay',
  beepay: 'BeePay',
  matrix: 'Matrix',
  tg_wallet: 'Telegram 钱包',
  manual: '手动 / 链上',
}
// 带下划线的 provider 要排在前面，避免 tg_wallet_php 被切成 tg
const KNOWN_PROVIDERS = ['tg_wallet', 'yfpay', 'beepay', 'matrix', 'manual']

// 支持余额查询的服务商
const BALANCE_PROVIDERS = ['yfpay', 'beepay'] as const

/** channel（格式 {provider}_{name}）→ provider；兼容 usdt / usdc 等手动链上渠道 */
function deriveProvider(channel: string): string {
  for (const p of KNOWN_PROVIDERS) {
    if (channel === p || channel.startsWith(`${p}_`) || channel.startsWith(`${p}-`)) return p
  }
  if (channel.startsWith('usdt') || channel.startsWith('usdc')) return 'manual'
  return channel.split(/[_-]/)[0] || channel
}

export interface AccountingRow {
  provider: string
  label: string
  /** 代收：充值成功金额合计（元） */
  depositAmount: number
  depositCount: number
  /** 代付：提现成功金额合计（元） */
  withdrawAmount: number
  withdrawCount: number
  /** 服务商手续费 */
  feeAmount: number
  /** 净额 = 代收 − 代付 */
  netAmount: number
  /** 账面余额 = 代收 − 代付 − 手续费 */
  bookBalance: number
}

interface ChannelAggRow extends RowDataPacket {
  channel: string
  amt: string | number
  cnt: number
}

interface ChannelFeeRow extends RowDataPacket {
  name: string
  provider: string
  deposit_fee_type: string
  deposit_fee_value: string | number
  withdraw_fee_type: string
  withdraw_fee_value: string | number
}

/**
 * 按服务商汇总代收（充值 status=paid）与代付（提现 status=completed）。
 * from/to 为可选时间范围（ISO 或 'YYYY-MM-DD HH:mm:ss'），按 created_at 过滤。
 */
export async function getAccounting(
  env: Env,
  range: { from?: string; to?: string } = {},
): Promise<{ rows: AccountingRow[]; total: AccountingRow }> {
  const where: string[] = []
  const params: string[] = []
  if (range.from) { where.push('created_at >= ?'); params.push(range.from) }
  if (range.to) { where.push('created_at <= ?'); params.push(range.to) }
  const rangeSql = where.length ? ` AND ${where.join(' AND ')}` : ''

  const [depRows] = await pool(env).query<ChannelAggRow[]>(
    `SELECT channel, COALESCE(SUM(amount),0) amt, COUNT(*) cnt
       FROM bg_deposit_order WHERE status = 'paid'${rangeSql} GROUP BY channel`,
    params,
  )
  const [witRows] = await pool(env).query<ChannelAggRow[]>(
    `SELECT channel, COALESCE(SUM(amount),0) amt, COUNT(*) cnt
       FROM bg_withdraw_order WHERE status = 'completed'${rangeSql} GROUP BY channel`,
    params,
  )
  const feeMap = await getChannelFeeMap(env)

  const map = new Map<string, AccountingRow>()
  const get = (provider: string): AccountingRow => {
    let r = map.get(provider)
    if (!r) {
      r = {
        provider, label: PROVIDER_LABELS[provider] ?? provider,
        depositAmount: 0, depositCount: 0, withdrawAmount: 0, withdrawCount: 0,
        feeAmount: 0, netAmount: 0, bookBalance: 0,
      }
      map.set(provider, r)
    }
    return r
  }
  for (const row of depRows) {
    const r = get(deriveProvider(row.channel))
    const amount = Number(row.amt)
    r.depositAmount += amount
    r.depositCount += Number(row.cnt)
    r.feeAmount += calcChannelFee(feeMap, row.channel, 'deposit', amount, Number(row.cnt))
  }
  for (const row of witRows) {
    const r = get(deriveProvider(row.channel))
    const amount = Number(row.amt)
    r.withdrawAmount += amount
    r.withdrawCount += Number(row.cnt)
    r.feeAmount += calcChannelFee(feeMap, row.channel, 'withdraw', amount, Number(row.cnt))
  }

  const rows = [...map.values()]
  rows.forEach((r) => {
    r.feeAmount = round2(r.feeAmount)
    r.netAmount = round2(r.depositAmount - r.withdrawAmount)
    r.bookBalance = round2(r.netAmount - r.feeAmount)
  })
  rows.sort((a, b) => b.depositAmount - a.depositAmount)

  const total: AccountingRow = {
    provider: '__total__', label: '合计',
    depositAmount: 0, depositCount: 0, withdrawAmount: 0, withdrawCount: 0,
    feeAmount: 0, netAmount: 0, bookBalance: 0,
  }
  for (const r of rows) {
    total.depositAmount += r.depositAmount
    total.depositCount += r.depositCount
    total.withdrawAmount += r.withdrawAmount
    total.withdrawCount += r.withdrawCount
    total.feeAmount += r.feeAmount
  }
  total.depositAmount = round2(total.depositAmount)
  total.withdrawAmount = round2(total.withdrawAmount)
  total.feeAmount = round2(total.feeAmount)
  total.netAmount = round2(total.depositAmount - total.withdrawAmount)
  total.bookBalance = round2(total.netAmount - total.feeAmount)
  rows.forEach((r) => { r.depositAmount = round2(r.depositAmount); r.withdrawAmount = round2(r.withdrawAmount) })

  return { rows, total }
}

export interface BalanceRow {
  provider: string
  label: string
  balance: number
  frozen: number
  observedBalance: number
  bookBalance: number
  diffAmount: number
  diffStatus: 'normal' | 'mismatch' | 'error'
  currency: string
  status: 'ok' | 'error'
  errorMsg: string | null
  updatedAt: string | null
}

interface BalanceDbRow extends RowDataPacket {
  provider: string
  balance: string | number
  frozen: string | number
  currency: string
  status: string
  error_msg: string | null
  updated_at: Date | string
}

/** 读取各服务商最新余额快照 */
export async function getBalances(env: Env): Promise<BalanceRow[]> {
  const [rows] = await pool(env).query<BalanceDbRow[]>(
    `SELECT provider, balance, frozen, currency, status, error_msg, updated_at FROM provider_balance_snapshot`,
  )
  const byProvider = new Map(rows.map((r) => [r.provider, r]))
  const accounting = await getAccounting(env)
  const bookBalanceByProvider = new Map(accounting.rows.map((r) => [r.provider, r.bookBalance]))
  return BALANCE_PROVIDERS.map((p) => {
    const r = byProvider.get(p)
    const balance = r ? Number(r.balance) : 0
    const frozen = r ? Number(r.frozen) : 0
    const observedBalance = round2(balance + frozen)
    const bookBalance = round2(bookBalanceByProvider.get(p) ?? 0)
    const diffAmount = round2(observedBalance - bookBalance)
    const status = (r?.status as 'ok' | 'error') ?? 'error'
    return {
      provider: p,
      label: PROVIDER_LABELS[p] ?? p,
      balance,
      frozen,
      observedBalance,
      bookBalance,
      diffAmount,
      diffStatus: status === 'error' ? 'error' : Math.abs(diffAmount) > 1 ? 'mismatch' : 'normal',
      currency: r?.currency ?? 'PHP',
      status,
      errorMsg: r?.error_msg ?? (r ? null : '尚未刷新'),
      updatedAt: r ? new Date(r.updated_at).toISOString() : null,
    }
  })
}

/** 拉取各服务商实时余额并写入快照（手动刷新 + 定时刷新共用） */
export async function refreshBalances(env: Env): Promise<BalanceRow[]> {
  await Promise.all(BALANCE_PROVIDERS.map((p) => refreshOne(env, p)))
  return getBalances(env)
}

async function refreshOne(env: Env, provider: (typeof BALANCE_PROVIDERS)[number]): Promise<void> {
  try {
    let balance = 0
    let frozen = 0
    let currency = 'PHP'
    if (provider === 'yfpay') {
      const r = await yfpayGetBalance(env)
      balance = Number(r.balance) || 0
      frozen = Number(r.frozen) || 0
      await insertBalanceHistory(env, { provider, balance, frozen, currency, status: 'ok', errorMsg: null, rawResponse: r })
    } else {
      const r = await beepayGetBalance(env)
      balance = Number(r.balance) || 0
      currency = r.currency || 'PHP'
      await insertBalanceHistory(env, { provider, balance, frozen, currency, status: 'ok', errorMsg: null, rawResponse: r })
    }
    await upsertBalance(env, { provider, balance, frozen, currency, status: 'ok', errorMsg: null })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await insertBalanceHistory(env, { provider, balance: null, frozen: null, currency: 'PHP', status: 'error', errorMsg: msg.slice(0, 500), rawResponse: null })
    await markBalanceError(env, provider, msg.slice(0, 500))
  }
}

async function upsertBalance(
  env: Env,
  d: { provider: string; balance: number; frozen: number; currency: string; status: 'ok' | 'error'; errorMsg: string | null },
): Promise<void> {
  await pool(env).execute(
    `INSERT INTO provider_balance_snapshot (provider, balance, frozen, currency, status, error_msg)
       VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE balance=VALUES(balance), frozen=VALUES(frozen), currency=VALUES(currency),
       status=VALUES(status), error_msg=VALUES(error_msg), updated_at=CURRENT_TIMESTAMP`,
    [d.provider, d.balance, d.frozen, d.currency, d.status, d.errorMsg],
  )
}

async function markBalanceError(env: Env, provider: string, errorMsg: string): Promise<void> {
  await pool(env).execute(
    `INSERT INTO provider_balance_snapshot (provider, balance, frozen, currency, status, error_msg)
       VALUES (?,0,0,'PHP','error',?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), error_msg=VALUES(error_msg), updated_at=CURRENT_TIMESTAMP`,
    [provider, errorMsg],
  )
}

async function insertBalanceHistory(
  env: Env,
  d: {
    provider: string
    balance: number | null
    frozen: number | null
    currency: string
    status: 'ok' | 'error'
    errorMsg: string | null
    rawResponse: unknown
  },
): Promise<void> {
  await pool(env).execute(
    `INSERT INTO provider_balance_snapshot_history
       (provider, balance, frozen, currency, status, error_msg, raw_response)
     VALUES (?,?,?,?,?,?,?)`,
    [d.provider, d.balance, d.frozen, d.currency, d.status, d.errorMsg, d.rawResponse === null ? null : JSON.stringify(d.rawResponse)],
  )
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

async function getChannelFeeMap(env: Env): Promise<Map<string, ChannelFeeRow>> {
  const [rows] = await pool(env).query<ChannelFeeRow[]>(
    `SELECT name, provider, deposit_fee_type, deposit_fee_value, withdraw_fee_type, withdraw_fee_value
       FROM payment_channels`,
  )
  return new Map(rows.map((r) => [`${r.provider}:${r.name}`, r]))
}

function calcChannelFee(
  feeMap: Map<string, ChannelFeeRow>,
  channel: string,
  txType: 'deposit' | 'withdraw',
  amount: number,
  count: number,
): number {
  const provider = deriveProvider(channel)
  const name = deriveChannelName(channel, provider)
  const fee = feeMap.get(`${provider}:${name}`)
  if (!fee) return 0
  const type = txType === 'deposit' ? fee.deposit_fee_type : fee.withdraw_fee_type
  const value = Number(txType === 'deposit' ? fee.deposit_fee_value : fee.withdraw_fee_value)
  if (type === 'percent') return amount * value
  if (type === 'fixed') return count * value
  return 0
}

function deriveChannelName(channel: string, provider: string): string {
  if (channel.startsWith(`${provider}_`) || channel.startsWith(`${provider}-`)) {
    return channel.slice(provider.length + 1)
  }
  return channel
}
