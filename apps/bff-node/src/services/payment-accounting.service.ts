import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { getBalance as yfpayGetBalance } from './yfpay.service.js'
import { getBalance as beepayGetBalance } from './beepay.service.js'
import { getAdminSetting, setAdminSetting } from './admin-store.js'
import { notifyProviderBalanceLow } from './admin-notify.js'

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

// 已知支付服务商（订单表无 provider 列，需从 channel 前缀解析）
const PROVIDER_LABELS: Record<string, string> = {
  yfpay: 'YFPay',
  beepay: 'BeePay',
  unispay: 'UnisPay',
  matrix: 'Matrix',
  tg_wallet: 'Telegram 钱包',
  manual: '手动 / 链上',
}
// 带下划线的 provider 要排在前面，避免 tg_wallet_php 被切成 tg
const KNOWN_PROVIDERS = ['tg_wallet', 'yfpay', 'beepay', 'unispay', 'matrix', 'manual']

// 支持余额查询 API 的服务商
const BALANCE_PROVIDERS = ['yfpay', 'beepay'] as const
// 无余额 API、只能手动登记余额的服务商
const MANUAL_BALANCE_PROVIDERS = ['matrix'] as const
export const ALERT_PROVIDERS: string[] = [...BALANCE_PROVIDERS, ...MANUAL_BALANCE_PROVIDERS]

// Matrix 链上出款真实 gas（固定，已转嫁给用户收取）
export const MATRIX_GAS_COST = 1.2

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
  /** api = 服务商接口自动查询；manual = 后台手动登记（Matrix） */
  source: 'api' | 'manual'
  /** 告警金额，0 或 null = 未设置 */
  alertThreshold: number | null
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
  const thresholds = new Map(await Promise.all(
    ALERT_PROVIDERS.map(async (p) => [p, await getAlertThreshold(env, p)] as const),
  ))
  const apiRows: BalanceRow[] = BALANCE_PROVIDERS.map((p) => {
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
      source: 'api' as const,
      alertThreshold: thresholds.get(p) ?? null,
    }
  })
  // Matrix 无余额 API：手动登记，用户取款自动扣减，不与账面对比
  const manualRows: BalanceRow[] = MANUAL_BALANCE_PROVIDERS.map((p) => {
    const r = byProvider.get(p)
    const balance = r ? Number(r.balance) : 0
    return {
      provider: p,
      label: PROVIDER_LABELS[p] ?? p,
      balance,
      frozen: 0,
      observedBalance: balance,
      bookBalance: 0,
      diffAmount: 0,
      diffStatus: (r ? 'normal' : 'error') as BalanceRow['diffStatus'],
      currency: r?.currency ?? 'USDT',
      status: r ? 'ok' : 'error',
      errorMsg: r ? null : '尚未登记余额',
      updatedAt: r ? new Date(r.updated_at).toISOString() : null,
      source: 'manual' as const,
      alertThreshold: thresholds.get(p) ?? null,
    }
  })
  return [...apiRows, ...manualRows]
}

/** 拉取各服务商实时余额并写入快照（手动刷新 + 定时刷新共用） */
export async function refreshBalances(env: Env): Promise<BalanceRow[]> {
  await Promise.all(BALANCE_PROVIDERS.map((p) => refreshOne(env, p)))
  // 刷新后检查低余额告警（Matrix 也一并检查，兼作 6 小时重复提醒）
  await Promise.all(ALERT_PROVIDERS.map((p) => checkBalanceAlert(env, p)))
  return getBalances(env)
}

// ── 低余额告警 ────────────────────────────────────────────────────────────────

const ALERT_THRESHOLD_KEY = (p: string) => `balance_alert_threshold:${p}`
// 值为上次告警时间戳（ms），余额恢复后清零
const ALERT_STATE_KEY = (p: string) => `balance_alert_state:${p}`
const ALERT_REPEAT_MS = 6 * 60 * 60 * 1000 // 低于阈值期间最多每 6 小时提醒一次

async function getAlertThreshold(env: Env, provider: string): Promise<number | null> {
  const raw = await getAdminSetting(env, ALERT_THRESHOLD_KEY(provider))
  const n = Number(raw)
  return raw !== null && Number.isFinite(n) && n > 0 ? n : null
}

export async function setAlertThreshold(env: Env, provider: string, threshold: number): Promise<void> {
  await setAdminSetting(env, ALERT_THRESHOLD_KEY(provider), String(threshold))
  if (threshold > 0) await checkBalanceAlert(env, provider)
}

/** 余额低于阈值时发 TG 告警；恢复后重置状态。失败静默，不影响主流程。 */
export async function checkBalanceAlert(env: Env, provider: string): Promise<void> {
  try {
    const threshold = await getAlertThreshold(env, provider)
    if (threshold === null) return
    const [rows] = await pool(env).query<BalanceDbRow[]>(
      `SELECT provider, balance, frozen, currency, status, error_msg, updated_at
         FROM provider_balance_snapshot WHERE provider = ?`,
      [provider],
    )
    const r = rows[0]
    if (!r || r.status !== 'ok') return
    const balance = Number(r.balance)
    const stateRaw = await getAdminSetting(env, ALERT_STATE_KEY(provider))
    const lastAlertAt = Number(stateRaw) || 0
    if (balance < threshold) {
      if (Date.now() - lastAlertAt < ALERT_REPEAT_MS) return
      await setAdminSetting(env, ALERT_STATE_KEY(provider), String(Date.now()))
      await notifyProviderBalanceLow(env, {
        provider,
        label: PROVIDER_LABELS[provider] ?? provider,
        balance,
        threshold,
        currency: r.currency,
      })
    } else if (lastAlertAt) {
      await setAdminSetting(env, ALERT_STATE_KEY(provider), '0')
    }
  } catch (e) {
    console.error('[balance-alert] check failed:', provider, e)
  }
}

/** 出款发起成功后即时刷新该服务商余额并检查告警（不等每小时定时刷新） */
export async function refreshAndCheckProviderBalance(
  env: Env,
  provider: (typeof BALANCE_PROVIDERS)[number],
): Promise<void> {
  await refreshOne(env, provider)
  await checkBalanceAlert(env, provider)
}

// ── Matrix 手动余额登记 / 取款自动扣减 ────────────────────────────────────────

export async function setManualProviderBalance(env: Env, provider: string, balance: number): Promise<void> {
  const currency = 'USDT'
  await upsertBalance(env, { provider, balance, frozen: 0, currency, status: 'ok', errorMsg: null })
  await insertBalanceHistory(env, {
    provider, balance, frozen: 0, currency, status: 'ok', errorMsg: null,
    rawResponse: { manual: true },
  })
  await checkBalanceAlert(env, provider)
}

/**
 * Matrix 出款成功发起后扣减登记余额（链上出款额 + gas）。
 * 未登记过余额时静默跳过；出款失败回调会在 core-node 侧把该金额加回。
 */
export async function deductMatrixBalance(env: Env, amount: number, orderId: string): Promise<void> {
  try {
    const [ret] = await pool(env).execute<ResultSetHeader>(
      `UPDATE provider_balance_snapshot
          SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
        WHERE provider = 'matrix'`,
      [round2(amount)],
    )
    if (ret.affectedRows === 0) return
    const [rows] = await pool(env).query<BalanceDbRow[]>(
      `SELECT balance, currency FROM provider_balance_snapshot WHERE provider = 'matrix'`,
    )
    await insertBalanceHistory(env, {
      provider: 'matrix', balance: Number(rows[0]?.balance ?? 0), frozen: 0,
      currency: String(rows[0]?.currency ?? 'USDT'), status: 'ok', errorMsg: null,
      rawResponse: { withdrawOrderId: orderId, deducted: round2(amount) },
    })
    await checkBalanceAlert(env, 'matrix')
  } catch (e) {
    console.error('[balance-alert] deduct matrix failed:', orderId, e)
  }
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
