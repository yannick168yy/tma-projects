import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { childLogger } from '../../lib/logger.js'
import { round4 } from './billing-engine.js'

const log = childLogger('tenant-account')

export const SETTLE_CURRENCY = 'USDT'

export type LedgerBizType =
  | 'margin_in' | 'margin_out' | 'invoice_settle' | 'manual_adjust'
  | 'payout' | 'collect' | 'credit_change'

export interface TenantAccount {
  tenantId: number
  currency: string
  balance: number
  depositAmount: number
  creditLimit: number
  warnThreshold: number | null
  /** 可动用额度 = 余额 + 授信。押金不算在内：押金是违约金来源，不是运营资金 */
  available: number
  updatedAt: string | null
}

function mapAccount(r: RowDataPacket): TenantAccount {
  const balance = Number(r.balance)
  const creditLimit = Number(r.credit_limit)
  return {
    tenantId: r.tenant_id,
    currency: r.currency,
    balance,
    depositAmount: Number(r.deposit_amount),
    creditLimit,
    warnThreshold: r.warn_threshold === null ? null : Number(r.warn_threshold),
    available: round4(balance + creditLimit),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at ?? null,
  }
}

/** 取账户，没有就建一条零余额的。开站时不预建 —— 没签商务合同的租户不该有账户 */
export async function ensureAccount(tenantId: number, currency = SETTLE_CURRENCY): Promise<TenantAccount> {
  const pool = getPlatformPool()
  await pool.execute(
    'INSERT IGNORE INTO pf_tenant_account (tenant_id, currency) VALUES (?, ?)', [tenantId, currency])
  const [[row]] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM pf_tenant_account WHERE tenant_id = ? AND currency = ?',
    [tenantId, currency]) as unknown as [RowDataPacket[]]
  return mapAccount(row)
}

export async function listAccounts(): Promise<Array<TenantAccount & { code: string; name: string; status: string }>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT a.*, t.code, t.name, t.status FROM pf_tenant_account a
       JOIN pf_tenant t ON t.id = a.tenant_id ORDER BY a.balance + a.credit_limit`)
  return rows.map((r) => ({ ...mapAccount(r), code: r.code, name: r.name, status: r.status }))
}

export interface LedgerInput {
  tenantId: number
  currency?: string
  bizType: LedgerBizType
  /** 正=账户增加，负=账户减少 */
  amount: number
  refType?: string | null
  refId?: string | null
  remark?: string | null
  operatorId?: number | null
}

/**
 * 记一笔额度流水并同步账户余额。
 *
 * 🔴 流水表只 INSERT，永不改。金额算错只能反向再记一笔，不能改历史行 ——
 * 出纠纷时这张表是唯一事实依据，能改就不是依据了。
 *
 * (tenant, biz_type, ref_type, ref_id) 唯一：代付重试、账单重复核销都撞这个键，
 * 撞上就返回 duplicated=true，调用方按「已记过」处理。
 */
export async function postLedger(input: LedgerInput): Promise<{ duplicated: boolean; balanceAfter: number }> {
  const currency = input.currency ?? SETTLE_CURRENCY
  const amount = round4(input.amount)
  const pool = getPlatformPool()
  await pool.execute('INSERT IGNORE INTO pf_tenant_account (tenant_id, currency) VALUES (?, ?)',
    [input.tenantId, currency])

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[acc]] = await conn.query<RowDataPacket[]>(
      'SELECT balance FROM pf_tenant_account WHERE tenant_id = ? AND currency = ? FOR UPDATE',
      [input.tenantId, currency]) as unknown as [RowDataPacket[]]
    const balanceAfter = round4(Number(acc.balance) + amount)
    try {
      await conn.execute(
        `INSERT INTO pf_tenant_ledger
           (tenant_id, currency, biz_type, amount, balance_after, ref_type, ref_id, remark, operator_id)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [input.tenantId, currency, input.bizType, amount, balanceAfter,
         input.refType ?? null, input.refId ?? null, input.remark ?? null, input.operatorId ?? null])
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        await conn.rollback()
        log.info({ ...input }, '同一笔业务重复记账，已忽略')
        return { duplicated: true, balanceAfter: Number(acc.balance) }
      }
      throw err
    }
    await conn.execute(
      'UPDATE pf_tenant_account SET balance = ? WHERE tenant_id = ? AND currency = ?',
      [balanceAfter, input.tenantId, currency])
    await conn.commit()
    return { duplicated: false, balanceAfter }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export async function listLedger(tenantId: number, limit = 100): Promise<Array<{
  id: number; currency: string; bizType: string; amount: number; balanceAfter: number
  refType: string | null; refId: string | null; remark: string | null; createdAt: string
}>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT id, currency, biz_type, amount, balance_after, ref_type, ref_id, remark, created_at
       FROM pf_tenant_ledger WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`, [tenantId, limit])
  return rows.map((r) => ({
    id: r.id,
    currency: r.currency,
    bizType: r.biz_type,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    refType: r.ref_type,
    refId: r.ref_id,
    remark: r.remark,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }))
}

export async function setCreditLimit(
  tenantId: number, creditLimit: number, operatorId: number | null, currency = SETTLE_CURRENCY,
): Promise<void> {
  const pool = getPlatformPool()
  await pool.execute('INSERT IGNORE INTO pf_tenant_account (tenant_id, currency) VALUES (?, ?)', [tenantId, currency])
  const [[acc]] = await pool.query<RowDataPacket[]>(
    'SELECT credit_limit FROM pf_tenant_account WHERE tenant_id = ? AND currency = ?',
    [tenantId, currency]) as unknown as [RowDataPacket[]]
  const before = Number(acc.credit_limit)
  await pool.execute('UPDATE pf_tenant_account SET credit_limit = ? WHERE tenant_id = ? AND currency = ?',
    [round4(creditLimit), tenantId, currency])
  // 授信变更不动余额，但要在流水里留一条痕：调额是商务决策，事后要能查是谁什么时候放的
  await getPlatformPool().execute(
    `INSERT INTO pf_tenant_ledger (tenant_id, currency, biz_type, amount, balance_after, ref_type, ref_id, remark, operator_id)
     SELECT ?, ?, 'credit_change', 0, balance, 'credit', CONCAT('to:', ?), ?, ?
       FROM pf_tenant_account WHERE tenant_id = ? AND currency = ?`,
    [tenantId, currency, round4(creditLimit), `授信 ${before} → ${round4(creditLimit)}`, operatorId, tenantId, currency])
    .catch(() => { /* 同一目标额度重复设置会撞唯一键，忽略 */ })
}

export interface ManualQueueInput {
  tenantId: number
  kind: 'payout_insufficient' | 'invoice_overdue' | 'settle_failed'
  refType?: string | null
  refId?: string | null
  currency?: string
  amount?: number
  reason: string
}

/**
 * 转人工队列。额度不足时**不自动拒绝、不平台垫付**（已定的决策）：
 * 自动拒绝会让玩家提现失败，客户第二天就来吵；垫付则是平台单方面承担风险。
 */
export async function enqueueManual(input: ManualQueueInput): Promise<boolean> {
  const [res] = await getPlatformPool().execute(
    `INSERT IGNORE INTO pf_manual_queue (tenant_id, kind, ref_type, ref_id, currency, amount, reason)
     VALUES (?,?,?,?,?,?,?)`,
    [input.tenantId, input.kind, input.refType ?? null, input.refId ?? null,
     input.currency ?? SETTLE_CURRENCY, round4(input.amount ?? 0), input.reason])
  return (res as { affectedRows: number }).affectedRows > 0
}

export async function listManualQueue(status = 'pending'): Promise<Array<{
  id: number; tenantId: number; code: string; kind: string; refType: string | null; refId: string | null
  currency: string; amount: number; reason: string; status: string; createdAt: string
}>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT q.*, t.code FROM pf_manual_queue q JOIN pf_tenant t ON t.id = q.tenant_id
      WHERE q.status = ? ORDER BY q.id DESC LIMIT 200`, [status])
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    kind: r.kind,
    refType: r.ref_type,
    refId: r.ref_id,
    currency: r.currency,
    amount: Number(r.amount),
    reason: r.reason,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }))
}

export async function resolveManual(
  id: number, status: 'resolved' | 'rejected', adminId: number | null, note: string | null,
): Promise<boolean> {
  const [res] = await getPlatformPool().execute(
    `UPDATE pf_manual_queue SET status = ?, resolved_by = ?, resolved_at = NOW(3), note = ?
      WHERE id = ? AND status = 'pending'`, [status, adminId, note, id])
  return (res as { affectedRows: number }).affectedRows > 0
}

/** 供代付链路调用：额度够不够。不够时由调用方决定转人工还是等客户充额度 */
export async function checkAvailable(
  tenantId: number, amount: number, currency = SETTLE_CURRENCY,
): Promise<{ ok: boolean; available: number }> {
  const acc = await ensureAccount(tenantId, currency)
  return { ok: acc.available >= round4(amount), available: acc.available }
}
