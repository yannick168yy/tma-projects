import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { currentTenant } from '../../lib/tenant-context.js'
import { requireRole } from '../../middleware/require-role.js'
import { ok, fail } from '../../utils/response.js'
import { getInvoice, listInvoices, transitionInvoice } from '../../services/billing/billing-invoice.service.js'
import { getTenantBillingPlan } from '../../services/billing/billing-plan.service.js'
import { ensureAccount, listLedger } from '../../services/billing/tenant-account.service.js'
import { writeAudit } from '../../services/platform-audit.service.js'

/**
 * 租户后台的「平台账单」（P2-12）。
 *
 * 🔴 所有查询都以 currentTenant().id 为准，绝不接受前端传 tenantId ——
 * P1-7 已经踩过一次：只要参数能指定租户，就等于开了跨租户读的口子。
 *
 * 客户在这里能做的只有两件事：确认账单、提出争议。金额调整与核销是平台侧动作，
 * 客户改不了自己该付多少。
 */
const router = new Router({ prefix: '/billing' })

const finance = requireRole(['super_admin', 'finance'], '只有超管与财务可以查看平台账单')

router.get('/summary', finance, async (ctx) => {
  const tenant = currentTenant()
  const [bound, account, invoices] = await Promise.all([
    getTenantBillingPlan(tenant.id),
    ensureAccount(tenant.id),
    listInvoices({ tenantId: tenant.id }),
  ])
  ok(ctx, {
    plan: bound ? {
      name: bound.plan.name,
      settleCurrency: bound.plan.settleCurrency,
      settleMode: bound.plan.settleMode,
      // 只给客户看规则的口径，不给规则 id：那是平台侧的编辑对象
      rules: bound.rules.map((r) => ({
        ruleType: r.ruleType, label: r.label, ratePct: r.ratePct, fixedAmount: r.fixedAmount,
        tiers: r.tiers, tierMode: r.tierMode, scope: r.scope,
        deductBonus: r.deductBonus, deductCommission: r.deductCommission,
        deductChannelFee: r.deductChannelFee, carryOver: r.carryOver,
      })),
    } : null,
    account: { balance: account.balance, creditLimit: account.creditLimit,
      depositAmount: account.depositAmount, available: account.available, currency: account.currency },
    pendingCount: invoices.filter((i) => i.status === 'issued').length,
    invoices,
  })
})

router.get('/invoices/:id', finance, async (ctx) => {
  const tenant = currentTenant()
  const res = await getInvoice(Number(ctx.params.id))
  if (!res || res.invoice.tenantId !== tenant.id) return fail(ctx, 404, '账单不存在')
  ok(ctx, res)
})

/** 对账明细：客户要能自己核每天的数，而不是只看到一个总额 */
router.get('/daily', finance, async (ctx) => {
  const tenant = currentTenant()
  const from = String(ctx.query.from ?? '')
  const to = String(ctx.query.to ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return fail(ctx, 400, '日期格式需为 YYYY-MM-DD')
  }
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT stat_date, currency, fx_rate_usdt, deposit_amount, deposit_platform, deposit_tenant,
            withdraw_amount, turnover, payout, ggr, bonus_cost, commission_cost, channel_fee, locked_at
       FROM pf_billing_daily WHERE tenant_id = ? AND stat_date BETWEEN ? AND ?
      ORDER BY stat_date DESC, currency`, [tenant.id, from, to])
  ok(ctx, rows.map((r) => ({
    statDate: r.stat_date instanceof Date ? r.stat_date.toISOString().slice(0, 10) : String(r.stat_date).slice(0, 10),
    currency: r.currency,
    fxRateUsdt: Number(r.fx_rate_usdt),
    depositAmount: Number(r.deposit_amount),
    depositPlatform: Number(r.deposit_platform),
    depositTenant: Number(r.deposit_tenant),
    withdrawAmount: Number(r.withdraw_amount),
    turnover: Number(r.turnover),
    payout: Number(r.payout),
    ggr: Number(r.ggr),
    bonusCost: Number(r.bonus_cost),
    commissionCost: Number(r.commission_cost),
    channelFee: Number(r.channel_fee),
    locked: r.locked_at !== null,
  })))
})

router.get('/account/ledger', finance, async (ctx) => {
  ok(ctx, await listLedger(currentTenant().id, 200))
})

router.put('/invoices/:id/confirm', finance, async (ctx) => {
  const tenant = currentTenant()
  const id = Number(ctx.params.id)
  const res = await getInvoice(id)
  if (!res || res.invoice.tenantId !== tenant.id) return fail(ctx, 404, '账单不存在')
  try {
    const inv = await transitionInvoice(id, 'confirmed', { env: ctx.state.env })
    await writeAudit(null, ctx.ip, 'billing.invoice.tenant_confirm', tenant.id,
      { id, by: ctx.state.adminUsername })
    ok(ctx, inv)
  } catch (err) {
    return fail(ctx, 400, (err as Error).message)
  }
})

router.put('/invoices/:id/dispute', finance, async (ctx) => {
  const tenant = currentTenant()
  const id = Number(ctx.params.id)
  const reason = String((ctx.request.body as { reason?: unknown }).reason ?? '').trim()
  if (!reason) return fail(ctx, 400, '请填写争议原因')
  const res = await getInvoice(id)
  if (!res || res.invoice.tenantId !== tenant.id) return fail(ctx, 404, '账单不存在')
  try {
    const inv = await transitionInvoice(id, 'disputed', { reason })
    await writeAudit(null, ctx.ip, 'billing.invoice.tenant_dispute', tenant.id,
      { id, reason, by: ctx.state.adminUsername })
    ok(ctx, inv)
  } catch (err) {
    return fail(ctx, 400, (err as Error).message)
  }
})

/**
 * 账单导出 CSV。
 * 不做 PDF：客户拿去对账用的是表格，PDF 还得再手工抄一遍数字。
 */
router.get('/invoices/:id/export', finance, async (ctx) => {
  const tenant = currentTenant()
  const res = await getInvoice(Number(ctx.params.id))
  if (!res || res.invoice.tenantId !== tenant.id) return fail(ctx, 404, '账单不存在')
  const { invoice, items } = res
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    ['账单号', invoice.invoiceNo].map(esc).join(','),
    ['结算周期', `${invoice.periodStart} ~ ${invoice.periodEnd}`].map(esc).join(','),
    ['结算币种', invoice.currency].map(esc).join(','),
    '',
    ['项目', '计费基数', '费率(%)', '金额'].map(esc).join(','),
    ...items.map((i) => [i.label, i.basisAmount, i.ratePct ?? '分档', i.amount].map(esc).join(',')),
    '',
    ['规则合计', invoice.grossAmount].map(esc).join(','),
    ['人工调整', invoice.adjustAmount].map(esc).join(','),
    ['应付合计', invoice.totalAmount].map(esc).join(','),
    ['上期结转', invoice.carryIn].map(esc).join(','),
    ['结转下期', invoice.carryOut].map(esc).join(','),
  ]
  ctx.set('Content-Type', 'text/csv; charset=utf-8')
  ctx.set('Content-Disposition', `attachment; filename="${invoice.invoiceNo}.csv"`)
  // BOM：Excel 不加这个会把中文列名显示成乱码
  ctx.body = `﻿${lines.join('\n')}`
})

export default router
