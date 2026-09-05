import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { getDefaultRedis } from '../../clients/redis.client.js'
import type { Env } from '../../config/env.js'
import { childLogger } from '../../lib/logger.js'
import { invalidateTenantHostCache } from '../tenant.service.js'
import { writeAudit } from '../platform-audit.service.js'
import { enqueueManual } from './tenant-account.service.js'

const log = childLogger('dunning')

/**
 * 欠费三级降级（P2-10）。
 *
 * 分级按「账单逾期天数」而不是「余额是否为负」：余额负数可能只是还没充额度，
 * 而逾期天数是双方在合同里认过的口径，降级时说得清。
 *
 * 每一级都留人工介入窗口：进入下一级之前先写人工队列（催收提醒），
 * 商务可以先联系客户、临时调授信，而不是让系统直接把客户的站停掉。
 */
export interface DunningPolicy {
  /** 逾期多少天停提现 */
  warnDays: number
  suspendWithdrawDays: number
  suspendDepositDays: number
  suspendSiteDays: number
}

export function policyFromEnv(): DunningPolicy {
  const n = (key: string, dflt: number): number => {
    const v = Number(process.env[key])
    return Number.isFinite(v) && v >= 0 ? v : dflt
  }
  return {
    warnDays: n('BILLING_DUNNING_WARN_DAYS', 1),
    suspendWithdrawDays: n('BILLING_DUNNING_WITHDRAW_DAYS', 3),
    suspendDepositDays: n('BILLING_DUNNING_DEPOSIT_DAYS', 7),
    suspendSiteDays: n('BILLING_DUNNING_SITE_DAYS', 14),
  }
}

/** 降级造成的状态。人工设成 trial/closed 的租户不参与自动恢复 */
const DEGRADED = new Set(['withdraw_suspended', 'deposit_suspended', 'suspended'])

interface OverdueRow extends RowDataPacket {
  tenant_id: number
  code: string
  status: string
  self_operated: number
  invoice_id: number
  invoice_no: string
  total_amount: string
  overdue_days: number
}

export interface DunningAction {
  tenantCode: string
  from: string
  to: string
  reason: string
}

/**
 * 跑一轮催收判定。返回实际发生的状态变更，便于日志与人工复核。
 *
 * 自营站永不降级：把它停了等于把整个平台自己关了。
 */
export async function runDunning(env: Env, policy = policyFromEnv()): Promise<DunningAction[]> {
  const pool = getPlatformPool()
  // 逾期定义：已开票（issued/confirmed）且未核销，按开票日算天数。
  // draft 不算逾期 —— 还没给客户看过的账单不能拿来停人家的站
  const [rows] = await pool.query<OverdueRow[]>(
    `SELECT t.id AS tenant_id, t.code, t.status, t.self_operated,
            i.id AS invoice_id, i.invoice_no, i.total_amount,
            DATEDIFF(NOW(), i.issued_at) AS overdue_days
       FROM pf_invoice i
       JOIN pf_tenant t ON t.id = i.tenant_id
      WHERE i.status IN ('issued','confirmed') AND i.issued_at IS NOT NULL
        AND t.self_operated = 0 AND t.status <> 'closed'
      ORDER BY overdue_days DESC`)

  // 一个租户可能有多张逾期账单，取最长逾期决定档位
  const worst = new Map<number, OverdueRow>()
  for (const r of rows) if (!worst.has(r.tenant_id)) worst.set(r.tenant_id, r)

  const actions: DunningAction[] = []
  for (const r of worst.values()) {
    const days = Number(r.overdue_days)
    let target: string | null = null
    if (days >= policy.suspendSiteDays) target = 'suspended'
    else if (days >= policy.suspendDepositDays) target = 'deposit_suspended'
    else if (days >= policy.suspendWithdrawDays) target = 'withdraw_suspended'

    if (days >= policy.warnDays) {
      const fresh = await enqueueManual({
        tenantId: r.tenant_id,
        kind: 'invoice_overdue',
        refType: 'invoice',
        refId: String(r.invoice_id),
        amount: Number(r.total_amount),
        reason: `${r.invoice_no} 已逾期 ${days} 天，未核销`,
      })
      if (fresh) log.warn({ tenant: r.code, invoice: r.invoice_no, days }, '账单逾期，已进人工队列')
    }

    // 只往更严格的方向走。恢复必须人工确认收款后由核销流程触发，
    // 不能让一次判定抖动把已经停站的客户自动放开
    if (!target || target === r.status) continue
    const severity = ['active', 'trial', 'withdraw_suspended', 'deposit_suspended', 'suspended']
    if (severity.indexOf(target) <= severity.indexOf(r.status)) continue

    await pool.execute('UPDATE pf_tenant SET status = ? WHERE id = ?', [target, r.tenant_id])
    await invalidateTenantHostCache(getDefaultRedis(env))
    await writeAudit(null, 'system', 'tenant.dunning', r.tenant_id,
      { from: r.status, to: target, invoice: r.invoice_no, overdueDays: days })
    actions.push({ tenantCode: r.code, from: r.status, to: target, reason: `${r.invoice_no} 逾期 ${days} 天` })
    log.warn({ tenant: r.code, from: r.status, to: target, days }, '欠费降级已执行')
  }
  return actions
}

/**
 * 结清后恢复。核销账单后调用：该租户不再有逾期账单且额度非负时，把降级状态放回 active。
 * 只恢复降级造成的状态 —— 人工停站（如合规问题）不能被一次付款自动解开。
 */
export async function restoreIfCleared(env: Env, tenantId: number): Promise<boolean> {
  const pool = getPlatformPool()
  const [[t]] = await pool.query<RowDataPacket[]>(
    'SELECT code, status, self_operated FROM pf_tenant WHERE id = ?',
    [tenantId]) as unknown as [RowDataPacket[]]
  if (!t || t.self_operated === 1 || !DEGRADED.has(String(t.status))) return false

  const [[overdue]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM pf_invoice
      WHERE tenant_id = ? AND status IN ('issued','confirmed') AND issued_at IS NOT NULL`,
    [tenantId]) as unknown as [RowDataPacket[]]
  if (Number(overdue.n) > 0) return false

  const [[acc]] = await pool.query<RowDataPacket[]>(
    'SELECT balance + credit_limit AS available FROM pf_tenant_account WHERE tenant_id = ?',
    [tenantId]) as unknown as [RowDataPacket[]]
  if (acc && Number(acc.available) < 0) return false

  await pool.execute("UPDATE pf_tenant SET status = 'active' WHERE id = ?", [tenantId])
  await invalidateTenantHostCache(getDefaultRedis(env))
  await writeAudit(null, 'system', 'tenant.dunning.restore', tenantId, { from: t.status, to: 'active' })
  log.info({ tenant: t.code, from: t.status }, '欠费已结清，站点状态恢复')
  return true
}
