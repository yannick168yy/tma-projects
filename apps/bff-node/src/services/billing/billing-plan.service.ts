import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import type { BillingRule, BillingTier, RuleType } from './billing-engine.js'

export const RULE_TYPES: RuleType[] = ['deposit_commission', 'ggr_share', 'turnover_rebate', 'monthly_fee']

export interface BillingPlanRow {
  id: number
  code: string
  name: string
  description: string | null
  settleMode: 'sum' | 'max_of_fee'
  settleCurrency: string
  period: 'monthly' | 'semi_monthly' | 'weekly'
  enabled: boolean
  tenantCount: number
  rules: BillingRule[]
}

function parseJson<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object') return raw as T
  try { return JSON.parse(String(raw)) as T } catch { return null }
}

export function mapRule(r: RowDataPacket): BillingRule {
  return {
    id: r.id,
    ruleType: r.rule_type as RuleType,
    label: r.label,
    ratePct: r.rate_pct === null ? null : Number(r.rate_pct),
    fixedAmount: r.fixed_amount === null ? null : Number(r.fixed_amount),
    tiers: parseJson<BillingTier[]>(r.tiers),
    tierMode: r.tier_mode === 'progressive' ? 'progressive' : 'flat',
    scope: r.scope,
    deductBonus: r.deduct_bonus === 1,
    deductCommission: r.deduct_commission === 1,
    deductChannelFee: r.deduct_channel_fee === 1,
    carryOver: r.carry_over === 1,
    venueRates: parseJson<Record<string, number>>(r.venue_rates),
    sortOrder: Number(r.sort_order),
  }
}

export async function listBillingPlans(): Promise<BillingPlanRow[]> {
  const pool = getPlatformPool()
  const [plans] = await pool.query<RowDataPacket[]>(
    `SELECT p.*, (SELECT COUNT(*) FROM pf_tenant_billing_plan tp
                   WHERE tp.billing_plan_id = p.id AND tp.ended_at IS NULL) AS tenant_count
       FROM pf_billing_plan p ORDER BY p.id`)
  const [rules] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM pf_billing_rule WHERE enabled = 1 ORDER BY sort_order, id')
  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    settleMode: p.settle_mode,
    settleCurrency: p.settle_currency,
    period: p.period,
    enabled: p.enabled === 1,
    tenantCount: Number(p.tenant_count),
    rules: rules.filter((r) => r.billing_plan_id === p.id).map(mapRule),
  }))
}

/** 租户当前挂的分成方案与规则。未挂方案返回 null —— 不给默认方案，免得算出一张谁都没签过的账单 */
export async function getTenantBillingPlan(tenantId: number): Promise<{
  plan: { id: number; code: string; name: string; settleMode: 'sum' | 'max_of_fee'; settleCurrency: string; period: string }
  rules: BillingRule[]
} | null> {
  const pool = getPlatformPool()
  const [[plan]] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.code, p.name, p.settle_mode, p.settle_currency, p.period
       FROM pf_tenant_billing_plan tp
       JOIN pf_billing_plan p ON p.id = tp.billing_plan_id
      WHERE tp.tenant_id = ? AND tp.ended_at IS NULL
      ORDER BY tp.started_at DESC LIMIT 1`, [tenantId]) as unknown as [RowDataPacket[]]
  if (!plan) return null
  const [rules] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM pf_billing_rule WHERE billing_plan_id = ? AND enabled = 1 ORDER BY sort_order, id', [plan.id])
  return {
    plan: {
      id: plan.id, code: plan.code, name: plan.name,
      settleMode: plan.settle_mode, settleCurrency: plan.settle_currency, period: plan.period,
    },
    rules: rules.map(mapRule),
  }
}

/** 换方案：旧记录填 ended_at 保留历史。已出账的周期照旧按当时的方案算，不追溯 */
export async function assignBillingPlan(tenantId: number, billingPlanId: number): Promise<void> {
  const pool = getPlatformPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      'UPDATE pf_tenant_billing_plan SET ended_at = NOW(3) WHERE tenant_id = ? AND ended_at IS NULL', [tenantId])
    await conn.execute(
      'INSERT INTO pf_tenant_billing_plan (tenant_id, billing_plan_id) VALUES (?, ?)', [tenantId, billingPlanId])
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export interface RuleInput {
  ruleType: RuleType
  label: string
  ratePct: number | null
  fixedAmount: number | null
  tiers: BillingTier[] | null
  tierMode: 'flat' | 'progressive'
  scope: 'all' | 'platform' | 'tenant'
  deductBonus: boolean
  deductCommission: boolean
  deductChannelFee: boolean
  carryOver: boolean
  venueRates: Record<string, number> | null
  sortOrder: number
}

/** 校验放在服务层：规则写坏了要到出账那天才发现，代价是一张算错的账单 */
export function validateRule(input: RuleInput): string | null {
  if (!RULE_TYPES.includes(input.ruleType)) return '未知的规则类型'
  if (!input.label.trim()) return '规则名称必填'
  if (input.ruleType === 'monthly_fee') {
    if (input.fixedAmount === null || input.fixedAmount < 0) return '月费金额必填且不能为负'
  } else if (input.tiers?.length) {
    let last = -1
    for (const t of input.tiers) {
      if (t.ratePct < 0 || t.ratePct > 100) return '分档费率需在 0~100 之间'
      if (t.upTo !== null && t.upTo <= last) return '分档上限必须递增'
      last = t.upTo ?? Infinity
    }
    if (!input.tiers.some((t) => t.upTo === null)) return '最高档必须留空上限，否则超出部分算不出费率'
  } else if (input.ratePct === null || input.ratePct < 0 || input.ratePct > 100) {
    return '费率需在 0~100 之间'
  }
  return null
}

export async function createRule(planId: number, input: RuleInput): Promise<number> {
  const [res] = await getPlatformPool().execute(
    `INSERT INTO pf_billing_rule
       (billing_plan_id, rule_type, label, rate_pct, fixed_amount, tiers, tier_mode, scope,
        deduct_bonus, deduct_commission, deduct_channel_fee, carry_over, venue_rates, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [planId, input.ruleType, input.label, input.ratePct, input.fixedAmount,
     input.tiers ? JSON.stringify(input.tiers) : null, input.tierMode, input.scope,
     input.deductBonus ? 1 : 0, input.deductCommission ? 1 : 0, input.deductChannelFee ? 1 : 0,
     input.carryOver ? 1 : 0, input.venueRates ? JSON.stringify(input.venueRates) : null, input.sortOrder])
  return (res as { insertId: number }).insertId
}

export async function updateRule(ruleId: number, input: RuleInput): Promise<void> {
  await getPlatformPool().execute(
    `UPDATE pf_billing_rule SET rule_type=?, label=?, rate_pct=?, fixed_amount=?, tiers=?, tier_mode=?, scope=?,
       deduct_bonus=?, deduct_commission=?, deduct_channel_fee=?, carry_over=?, venue_rates=?, sort_order=?
     WHERE id=?`,
    [input.ruleType, input.label, input.ratePct, input.fixedAmount,
     input.tiers ? JSON.stringify(input.tiers) : null, input.tierMode, input.scope,
     input.deductBonus ? 1 : 0, input.deductCommission ? 1 : 0, input.deductChannelFee ? 1 : 0,
     input.carryOver ? 1 : 0, input.venueRates ? JSON.stringify(input.venueRates) : null, input.sortOrder, ruleId])
}

/**
 * 规则不真删，置 enabled=0。
 * 历史账单的明细里记着规则算出的结果，但排查时还要能回看规则本身长什么样。
 */
export async function disableRule(ruleId: number): Promise<void> {
  await getPlatformPool().execute('UPDATE pf_billing_rule SET enabled = 0 WHERE id = ?', [ruleId])
}
