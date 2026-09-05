import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import type { Env } from '../../config/env.js'
import { childLogger } from '../../lib/logger.js'
import { computeBilling, round4, type BillingBasis, type ComputedItem } from './billing-engine.js'
import { getTenantBillingPlan } from './billing-plan.service.js'
import { lockDailyRange } from './billing-daily.service.js'
import { enqueueManual, postLedger, SETTLE_CURRENCY } from './tenant-account.service.js'
import { restoreIfCleared } from './dunning.service.js'

const log = childLogger('billing-invoice')

export type InvoiceStatus = 'draft' | 'issued' | 'confirmed' | 'disputed' | 'settled' | 'void'

/** 状态机。服务端是唯一边界，前端按钮只是少让人点错 */
const FLOW: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['issued', 'void'],
  issued: ['confirmed', 'disputed', 'void'],
  // 争议解决后回到 issued 重新走确认，不允许从争议直接核销：
  // 跳过确认就等于平台单方面认定金额，这正是争议要解决的东西
  disputed: ['issued', 'void'],
  confirmed: ['settled', 'disputed'],
  settled: [],
  void: [],
}

export interface InvoiceRow {
  id: number
  invoiceNo: string
  tenantId: number
  tenantCode?: string
  billingPlanId: number | null
  periodStart: string
  periodEnd: string
  currency: string
  carryIn: number
  carryOut: number
  grossAmount: number
  adjustAmount: number
  totalAmount: number
  status: InvoiceStatus
  disputeReason: string | null
  note: string | null
  issuedAt: string | null
  confirmedAt: string | null
  settledAt: string | null
  createdAt: string
}

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v)
const day = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)

function mapInvoice(r: RowDataPacket): InvoiceRow {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    tenantId: r.tenant_id,
    tenantCode: r.code,
    billingPlanId: r.billing_plan_id,
    periodStart: day(r.period_start),
    periodEnd: day(r.period_end),
    currency: r.currency,
    carryIn: Number(r.carry_in),
    carryOut: Number(r.carry_out),
    grossAmount: Number(r.gross_amount),
    adjustAmount: Number(r.adjust_amount),
    totalAmount: Number(r.total_amount),
    status: r.status,
    disputeReason: r.dispute_reason,
    note: r.note,
    issuedAt: iso(r.issued_at),
    confirmedAt: iso(r.confirmed_at),
    settledAt: iso(r.settled_at),
    createdAt: iso(r.created_at) ?? '',
  }
}

/**
 * 把周期内的日切快照汇总成结算币种口径的计费基数。
 *
 * 折算用**快照当日**的汇率（fx_rate_usdt），不用结算时的实时汇率：
 * 否则同一批流水，账单早出晚出金额不同，客户永远算不平。
 * 汇率缺失（fx=0）的行直接跳过并计数 —— 拿 0 参与计算会静默少收一整天的钱。
 */
export async function aggregateBasis(tenantId: number, start: string, end: string): Promise<{
  basis: BillingBasis
  days: number
  missingFx: string[]
}> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT * FROM pf_billing_daily
      WHERE tenant_id = ? AND stat_date BETWEEN ? AND ? ORDER BY stat_date`,
    [tenantId, start, end])

  const basis: BillingBasis = {
    depositAmount: 0, depositPlatform: 0, depositTenant: 0,
    turnover: 0, payout: 0, ggr: 0,
    bonusCost: 0, commissionCost: 0, channelFee: 0,
    venueTurnover: {},
    periodStart: start, periodEnd: end,
  }
  const missingFx: string[] = []
  const dates = new Set<string>()

  for (const r of rows) {
    const fx = Number(r.fx_rate_usdt)
    const date = day(r.stat_date)
    dates.add(date)
    if (!(fx > 0)) { missingFx.push(`${date} ${r.currency}`); continue }
    basis.depositAmount += Number(r.deposit_amount) * fx
    basis.depositPlatform += Number(r.deposit_platform) * fx
    basis.depositTenant += Number(r.deposit_tenant) * fx
    basis.turnover += Number(r.turnover) * fx
    basis.payout += Number(r.payout) * fx
    basis.ggr += Number(r.ggr) * fx
    basis.bonusCost += Number(r.bonus_cost) * fx
    basis.commissionCost += Number(r.commission_cost) * fx
    basis.channelFee += Number(r.channel_fee) * fx
    const venues = typeof r.venue_turnover === 'object' && r.venue_turnover !== null
      ? r.venue_turnover as Record<string, number>
      : JSON.parse(String(r.venue_turnover ?? '{}')) as Record<string, number>
    for (const [venue, amount] of Object.entries(venues)) {
      basis.venueTurnover[venue] = round4((basis.venueTurnover[venue] ?? 0) + Number(amount) * fx)
    }
  }

  for (const k of ['depositAmount', 'depositPlatform', 'depositTenant', 'turnover', 'payout', 'ggr',
    'bonusCost', 'commissionCost', 'channelFee'] as const) {
    basis[k] = round4(basis[k])
  }
  return { basis, days: dates.size, missingFx }
}

/** 上期结转：取该租户上一张已确认或已核销账单的 carry_out */
async function previousCarry(tenantId: number, start: string): Promise<number> {
  const [[row]] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT carry_out FROM pf_invoice
      WHERE tenant_id = ? AND period_end < ? AND status IN ('confirmed','settled')
      ORDER BY period_end DESC LIMIT 1`, [tenantId, start]) as unknown as [RowDataPacket[]]
  return row ? Number(row.carry_out) : 0
}

export async function previewInvoice(tenantId: number, start: string, end: string): Promise<{
  planName: string | null
  basis: BillingBasis
  days: number
  missingFx: string[]
  carryIn: number
  carryOut: number
  gross: number
  items: ComputedItem[]
}> {
  const bound = await getTenantBillingPlan(tenantId)
  const { basis, days, missingFx } = await aggregateBasis(tenantId, start, end)
  if (!bound) return { planName: null, basis, days, missingFx, carryIn: 0, carryOut: 0, gross: 0, items: [] }
  const carryIn = await previousCarry(tenantId, start)
  const { items, gross, carryOut } = computeBilling(basis, bound.rules, carryIn, bound.plan.settleMode)
  return { planName: bound.plan.name, basis, days, missingFx, carryIn, carryOut, gross, items }
}

/**
 * 生成账单（draft）。
 *
 * 生成成功即锁定该周期的日切快照 —— 之后 BI 回填也不再改动已出账的数字。
 * 同租户同周期唯一键挡住重复生成，不做「先删后建」：删掉的是客户可能已经看过的账单。
 */
export async function generateInvoice(
  tenantId: number, tenantCode: string, start: string, end: string, adminId: number | null,
): Promise<{ id: number; invoiceNo: string; total: number; itemCount: number }> {
  const bound = await getTenantBillingPlan(tenantId)
  if (!bound) throw new Error('该租户未挂分成方案，不能出账')
  const { basis, missingFx } = await aggregateBasis(tenantId, start, end)
  if (missingFx.length > 0) {
    throw new Error(`以下日期缺当日汇率快照，先补齐再出账：${missingFx.slice(0, 5).join('、')}`)
  }
  const carryIn = await previousCarry(tenantId, start)
  const { items, gross, carryOut } = computeBilling(basis, bound.rules, carryIn, bound.plan.settleMode)
  const invoiceNo = `INV-${start.slice(0, 7).replace('-', '')}-${tenantCode}`

  const pool = getPlatformPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [res] = await conn.execute(
      `INSERT INTO pf_invoice
         (invoice_no, tenant_id, billing_plan_id, period_start, period_end, currency,
          carry_in, carry_out, gross_amount, adjust_amount, total_amount, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,'draft',?)`,
      [invoiceNo, tenantId, bound.plan.id, start, end, bound.plan.settleCurrency,
       carryIn, carryOut, gross, gross, adminId])
    const invoiceId = (res as { insertId: number }).insertId
    let sort = 10
    for (const it of items) {
      await conn.execute(
        `INSERT INTO pf_invoice_item (invoice_id, rule_type, label, basis_amount, rate_pct, amount, detail, sort_order)
         VALUES (?,?,?,?,?,?,?,?)`,
        [invoiceId, it.ruleType, it.label, it.basisAmount, it.ratePct, it.amount, JSON.stringify(it.detail), sort])
      sort += 10
    }
    await conn.commit()
    await lockDailyRange(tenantId, start, end)
    log.info({ tenantId, invoiceNo, gross, items: items.length }, '账单已生成并锁定快照')
    return { id: invoiceId, invoiceNo, total: gross, itemCount: items.length }
  } catch (err) {
    await conn.rollback()
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new Error('该周期账单已存在，如需重出请先作废旧账单')
    }
    throw err
  } finally {
    conn.release()
  }
}

export async function listInvoices(filter: { tenantId?: number; status?: string } = {}): Promise<InvoiceRow[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.tenantId) { where.push('i.tenant_id = ?'); params.push(filter.tenantId) }
  if (filter.status) { where.push('i.status = ?'); params.push(filter.status) }
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT i.*, t.code FROM pf_invoice i JOIN pf_tenant t ON t.id = i.tenant_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY i.period_start DESC, i.id DESC LIMIT 300`, params)
  return rows.map(mapInvoice)
}

export async function getInvoice(id: number): Promise<{ invoice: InvoiceRow; items: Array<{
  ruleType: string; label: string; basisAmount: number; ratePct: number | null; amount: number; detail: unknown
}> } | null> {
  const pool = getPlatformPool()
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT i.*, t.code FROM pf_invoice i JOIN pf_tenant t ON t.id = i.tenant_id WHERE i.id = ?`,
    [id]) as unknown as [RowDataPacket[]]
  if (!row) return null
  const [items] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM pf_invoice_item WHERE invoice_id = ? ORDER BY sort_order, id', [id])
  return {
    invoice: mapInvoice(row),
    items: items.map((r) => ({
      ruleType: r.rule_type,
      label: r.label,
      basisAmount: Number(r.basis_amount),
      ratePct: r.rate_pct === null ? null : Number(r.rate_pct),
      amount: Number(r.amount),
      detail: typeof r.detail === 'object' ? r.detail : JSON.parse(String(r.detail ?? '{}')),
    })),
  }
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return (FLOW[from] ?? []).includes(to)
}

async function loadForUpdate(id: number): Promise<InvoiceRow | null> {
  const [[row]] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT i.*, t.code FROM pf_invoice i JOIN pf_tenant t ON t.id = i.tenant_id WHERE i.id = ?',
    [id]) as unknown as [RowDataPacket[]]
  return row ? mapInvoice(row) : null
}

export async function transitionInvoice(
  id: number, to: InvoiceStatus, opts: { reason?: string; adminId?: number | null; env?: Env } = {},
): Promise<InvoiceRow> {
  const inv = await loadForUpdate(id)
  if (!inv) throw new Error('账单不存在')
  if (!canTransition(inv.status, to)) throw new Error(`不允许从 ${inv.status} 变更为 ${to}`)
  if (to === 'settled') return settleInvoice(inv, opts.adminId ?? null, opts.env)

  const stamp = to === 'issued' ? ', issued_at = COALESCE(issued_at, NOW(3))'
    : to === 'confirmed' ? ', confirmed_at = NOW(3)' : ''
  await getPlatformPool().execute(
    `UPDATE pf_invoice SET status = ?, dispute_reason = ?${stamp} WHERE id = ?`,
    [to, to === 'disputed' ? (opts.reason ?? '未填原因') : null, id])
  return (await loadForUpdate(id))!
}

/**
 * 核销：从额度账户扣划。
 *
 * 余额允许被扣成负数（即欠款），不因为额度不足就拒绝核销 —— 账单该收的钱不会因为
 * 客户没钱而消失。扣完 available < 0 就进人工队列，由商务决定催收还是走降级。
 */
async function settleInvoice(inv: InvoiceRow, adminId: number | null, env?: Env): Promise<InvoiceRow> {
  const res = await postLedger({
    tenantId: inv.tenantId,
    currency: inv.currency,
    bizType: 'invoice_settle',
    amount: -inv.totalAmount,
    refType: 'invoice',
    refId: String(inv.id),
    remark: `${inv.invoiceNo} 核销`,
    operatorId: adminId,
  })
  await getPlatformPool().execute(
    "UPDATE pf_invoice SET status = 'settled', settled_at = NOW(3) WHERE id = ?", [inv.id])
  if (res.balanceAfter < 0) {
    await enqueueManual({
      tenantId: inv.tenantId,
      kind: 'invoice_overdue',
      refType: 'invoice',
      refId: String(inv.id),
      currency: inv.currency,
      amount: Math.abs(res.balanceAfter),
      reason: `${inv.invoiceNo} 核销后余额为 ${res.balanceAfter}，需催收或调整授信`,
    })
  }
  // 结清后自动恢复降级状态：客户付了钱还要等人工点一下恢复，是最容易被投诉的一环
  if (env && res.balanceAfter >= 0) await restoreIfCleared(env, inv.tenantId)
  log.info({ invoice: inv.invoiceNo, balanceAfter: res.balanceAfter }, '账单已核销')
  return (await loadForUpdate(inv.id))!
}

/** 人工调整。只在未确认前允许 —— 客户确认过的金额不能背后改 */
export async function adjustInvoice(
  id: number, adjust: number, note: string,
): Promise<InvoiceRow> {
  const inv = await loadForUpdate(id)
  if (!inv) throw new Error('账单不存在')
  if (inv.status === 'settled' || inv.status === 'void' || inv.status === 'confirmed') {
    throw new Error(`${inv.status} 状态的账单不允许调整金额`)
  }
  const total = round4(inv.grossAmount + adjust)
  await getPlatformPool().execute(
    'UPDATE pf_invoice SET adjust_amount = ?, total_amount = ?, note = ? WHERE id = ?',
    [round4(adjust), total, note, id])
  return (await loadForUpdate(id))!
}

/** 账单周期：给定日期所在自然月的起止 */
export function monthPeriod(date: string): { start: string; end: string } {
  const d = new Date(`${date}T00:00:00Z`)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const mm = String(m + 1).padStart(2, '0')
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

/** 上一个自然月。月初批量出账用 */
export function previousMonthPeriod(today = new Date()): { start: string; end: string } {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  const prev = new Date(Date.UTC(y, m - 1, 1))
  return monthPeriod(prev.toISOString().slice(0, 10))
}

export { SETTLE_CURRENCY }
