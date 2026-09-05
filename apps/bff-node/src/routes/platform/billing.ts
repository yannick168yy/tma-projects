import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { platformAuthMiddleware } from '../../middleware/platform-auth.js'
import { runWithTenant } from '../../lib/tenant-context.js'
import { tenantById } from '../../services/tenant.service.js'
import { writeAudit } from '../../services/platform-audit.service.js'
import { ok, fail } from '../../utils/response.js'
import {
  assignBillingPlan, createRule, disableRule, getTenantBillingPlan,
  listBillingPlans, updateRule, validateRule, type RuleInput,
} from '../../services/billing/billing-plan.service.js'
import { lockDailyRange, snapshotTenantDay, statDate } from '../../services/billing/billing-daily.service.js'
import {
  adjustInvoice, generateInvoice, getInvoice, listInvoices, monthPeriod,
  previewInvoice, previousMonthPeriod, transitionInvoice, type InvoiceStatus,
} from '../../services/billing/billing-invoice.service.js'
import {
  ensureAccount, enqueueManual, listAccounts, listLedger, listManualQueue,
  postLedger, resolveManual, setCreditLimit,
} from '../../services/billing/tenant-account.service.js'
import { policyFromEnv, runDunning } from '../../services/billing/dunning.service.js'
import { invalidateChannelOwnershipCache } from '../../services/billing/settlement-mode.service.js'
import { hasCredentialKey, maskSecret, openSecret, sealSecret } from '../../lib/secret-box.js'
import { platformTrend, reconcileByMode, runPlatformBi, tenantOverview } from '../../services/billing/platform-bi.service.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseRuleInput(body: Record<string, unknown>): RuleInput | string {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const input: RuleInput = {
    ruleType: String(body.ruleType ?? '') as RuleInput['ruleType'],
    label: String(body.label ?? '').trim(),
    ratePct: num(body.ratePct),
    fixedAmount: num(body.fixedAmount),
    tiers: Array.isArray(body.tiers) && body.tiers.length > 0
      ? (body.tiers as Array<{ upTo?: unknown; ratePct?: unknown }>).map((t) => ({
          upTo: num(t.upTo), ratePct: Number(t.ratePct ?? 0),
        }))
      : null,
    tierMode: body.tierMode === 'progressive' ? 'progressive' : 'flat',
    scope: body.scope === 'platform' || body.scope === 'tenant' ? body.scope : 'all',
    deductBonus: body.deductBonus !== false,
    deductCommission: body.deductCommission !== false,
    deductChannelFee: body.deductChannelFee !== false,
    carryOver: body.carryOver !== false,
    venueRates: body.venueRates && typeof body.venueRates === 'object'
      ? Object.fromEntries(Object.entries(body.venueRates as Record<string, unknown>)
          .map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number))) as Record<string, number>
      : null,
    sortOrder: Number(body.sortOrder ?? 100),
  }
  return validateRule(input) ?? input
}

/**
 * 平台计费 / 账单 / 额度接口（P2）。
 *
 * 单独成文件而不是继续堆 platform/index.ts：商务闭环这一块的读写面
 * 已经比整个 P1 的租户管理还大，混在一起没人找得到东西。
 *
 * 权限：查看给全部平台角色（运营也要能看账），**写操作只给财务与超管** ——
 * 出账、调金额、核销扣款都是钱的动作，运营不该有。
 */
export function createBillingRouter(): Router {
  const router = new Router({ prefix: '/platform/billing' })
  const read = platformAuthMiddleware()
  const write = platformAuthMiddleware('platform_super', 'platform_finance')

  // ── 分成方案 ──
  router.get('/plans', read, async (ctx) => {
    ok(ctx, await listBillingPlans())
  })

  router.post('/plans', write, async (ctx) => {
    const b = ctx.request.body as Record<string, unknown>
    const code = String(b.code ?? '').trim()
    const name = String(b.name ?? '').trim()
    if (!/^[a-z0-9_]{2,32}$/.test(code)) return fail(ctx, 400, '方案代号只允许小写字母、数字与下划线')
    if (!name) return fail(ctx, 400, '方案名称必填')
    const settleMode = b.settleMode === 'max_of_fee' ? 'max_of_fee' : 'sum'
    try {
      const [res] = await getPlatformPool().execute(
        `INSERT INTO pf_billing_plan (code, name, description, settle_mode, period) VALUES (?,?,?,?,?)`,
        [code, name, b.description ? String(b.description) : null, settleMode,
         b.period === 'weekly' || b.period === 'semi_monthly' ? b.period : 'monthly'])
      const id = (res as { insertId: number }).insertId
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.plan.create', null, { id, code, name })
      ok(ctx, { id, code, name })
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return fail(ctx, 400, '方案代号已存在')
      throw err
    }
  })

  router.put('/plans/:id', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const b = ctx.request.body as Record<string, unknown>
    const [res] = await getPlatformPool().execute(
      `UPDATE pf_billing_plan SET name = COALESCE(?, name), description = ?,
         settle_mode = COALESCE(?, settle_mode), enabled = COALESCE(?, enabled) WHERE id = ?`,
      [b.name ? String(b.name) : null, b.description === undefined ? null : String(b.description ?? ''),
       b.settleMode === 'sum' || b.settleMode === 'max_of_fee' ? b.settleMode : null,
       b.enabled === undefined ? null : (b.enabled ? 1 : 0), id])
    if ((res as { affectedRows: number }).affectedRows === 0) return fail(ctx, 404, '方案不存在')
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.plan.update', null, { id, ...b })
    ok(ctx, { id })
  })

  router.post('/plans/:id/rules', write, async (ctx) => {
    const planId = Number(ctx.params.id)
    const parsed = parseRuleInput(ctx.request.body as Record<string, unknown>)
    if (typeof parsed === 'string') return fail(ctx, 400, parsed)
    const id = await createRule(planId, parsed)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.rule.create', null, { planId, id, ...parsed })
    ok(ctx, { id })
  })

  router.put('/rules/:id', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const parsed = parseRuleInput(ctx.request.body as Record<string, unknown>)
    if (typeof parsed === 'string') return fail(ctx, 400, parsed)
    await updateRule(id, parsed)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.rule.update', null, { id, ...parsed })
    ok(ctx, { id })
  })

  router.delete('/rules/:id', write, async (ctx) => {
    const id = Number(ctx.params.id)
    await disableRule(id)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.rule.disable', null, { id })
    ok(ctx, { id })
  })

  // ── 租户维度 ──
  router.get('/tenants/:id/plan', read, async (ctx) => {
    const id = Number(ctx.params.id)
    ok(ctx, {
      bound: await getTenantBillingPlan(id),
      account: await ensureAccount(id),
    })
  })

  router.put('/tenants/:id/plan', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const planId = Number((ctx.request.body as { billingPlanId?: unknown }).billingPlanId)
    const [[plan]] = await getPlatformPool().query<RowDataPacket[]>(
      'SELECT id FROM pf_billing_plan WHERE id = ? AND enabled = 1', [planId]) as unknown as [RowDataPacket[]]
    if (!plan) return fail(ctx, 400, '分成方案不存在或已停用')
    await assignBillingPlan(id, planId)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.tenant.plan', id, { planId })
    ok(ctx, { tenantId: id, billingPlanId: planId })
  })

  router.get('/tenants/:id/daily', read, async (ctx) => {
    const id = Number(ctx.params.id)
    const to = String(ctx.query.to ?? statDate(-1))
    const from = String(ctx.query.from ?? statDate(-30))
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return fail(ctx, 400, '日期格式需为 YYYY-MM-DD')
    const [rows] = await getPlatformPool().query<RowDataPacket[]>(
      `SELECT * FROM pf_billing_daily WHERE tenant_id = ? AND stat_date BETWEEN ? AND ?
        ORDER BY stat_date DESC, currency`, [id, from, to])
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
      channelDetail: typeof r.channel_detail === 'object' ? r.channel_detail : JSON.parse(String(r.channel_detail ?? '{}')),
    })))
  })

  // 重算某天的快照。已锁定的行不会被覆盖 —— 出过账的数字不能背后改
  router.post('/tenants/:id/daily/recompute', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const date = String((ctx.request.body as { date?: unknown }).date ?? statDate(-1))
    if (!DATE_RE.test(date)) return fail(ctx, 400, '日期格式需为 YYYY-MM-DD')
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    const res = await runWithTenant(tenant, () => snapshotTenantDay(ctx.state.env, date))
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.daily.recompute', id, { date, ...res })
    ok(ctx, { date, ...res })
  })

  router.post('/tenants/:id/daily/lock', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const b = ctx.request.body as { from?: string; to?: string }
    if (!DATE_RE.test(String(b.from)) || !DATE_RE.test(String(b.to))) return fail(ctx, 400, '日期格式需为 YYYY-MM-DD')
    const n = await lockDailyRange(id, String(b.from), String(b.to))
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.daily.lock', id, { ...b, rows: n })
    ok(ctx, { locked: n })
  })

  // ── 账单 ──
  router.get('/invoices', read, async (ctx) => {
    ok(ctx, await listInvoices({
      tenantId: ctx.query.tenantId ? Number(ctx.query.tenantId) : undefined,
      status: ctx.query.status ? String(ctx.query.status) : undefined,
    }))
  })

  router.get('/invoices/:id', read, async (ctx) => {
    const res = await getInvoice(Number(ctx.params.id))
    if (!res) return fail(ctx, 404, '账单不存在')
    ok(ctx, res)
  })

  // 试算：出账前先看一眼金额与逐项明细，避免把算错的账发给客户
  router.get('/tenants/:id/invoices/preview', read, async (ctx) => {
    const id = Number(ctx.params.id)
    const period = ctx.query.month
      ? monthPeriod(`${String(ctx.query.month)}-01`)
      : previousMonthPeriod()
    ok(ctx, { period, ...await previewInvoice(id, period.start, period.end) })
  })

  router.post('/tenants/:id/invoices', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const b = ctx.request.body as { month?: string }
    const period = b.month ? monthPeriod(`${b.month}-01`) : previousMonthPeriod()
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    try {
      const res = await generateInvoice(id, tenant.code, period.start, period.end,
        ctx.state.platformAdmin?.adminId ?? null)
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.invoice.create', id, { ...period, ...res })
      ok(ctx, res)
    } catch (err) {
      return fail(ctx, 400, (err as Error).message)
    }
  })

  router.put('/invoices/:id/status', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const b = ctx.request.body as { status?: string; reason?: string }
    const to = String(b.status ?? '') as InvoiceStatus
    try {
      const inv = await transitionInvoice(id, to, {
        reason: b.reason, adminId: ctx.state.platformAdmin?.adminId ?? null, env: ctx.state.env,
      })
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.invoice.status', inv.tenantId,
        { id, to, reason: b.reason ?? null })
      ok(ctx, inv)
    } catch (err) {
      return fail(ctx, 400, (err as Error).message)
    }
  })

  router.put('/invoices/:id/adjust', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const b = ctx.request.body as { adjust?: unknown; note?: unknown }
    const adjust = Number(b.adjust)
    const note = String(b.note ?? '').trim()
    if (!Number.isFinite(adjust)) return fail(ctx, 400, '调整金额需为数字')
    // 调金额必须写原因：这是事后唯一能解释「为什么少收 500」的东西
    if (!note) return fail(ctx, 400, '人工调整必须填原因')
    try {
      const inv = await adjustInvoice(id, adjust, note)
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.invoice.adjust', inv.tenantId,
        { id, adjust, note })
      ok(ctx, inv)
    } catch (err) {
      return fail(ctx, 400, (err as Error).message)
    }
  })

  // ── 额度账户 ──
  router.get('/accounts', read, async (ctx) => {
    ok(ctx, await listAccounts())
  })

  router.get('/tenants/:id/account', read, async (ctx) => {
    const id = Number(ctx.params.id)
    ok(ctx, { account: await ensureAccount(id), ledger: await listLedger(id) })
  })

  router.post('/tenants/:id/account/ledger', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const b = ctx.request.body as { bizType?: string; amount?: unknown; remark?: unknown; refId?: unknown }
    const amount = Number(b.amount)
    const allowed = ['margin_in', 'margin_out', 'manual_adjust']
    if (!allowed.includes(String(b.bizType))) return fail(ctx, 400, `手工只允许记 ${allowed.join(' / ')}`)
    if (!Number.isFinite(amount) || amount === 0) return fail(ctx, 400, '金额需为非零数字')
    const remark = String(b.remark ?? '').trim()
    if (!remark) return fail(ctx, 400, '必须填写摘要')
    const res = await postLedger({
      tenantId: id,
      bizType: b.bizType as 'margin_in' | 'margin_out' | 'manual_adjust',
      amount,
      refType: 'manual',
      // 同一天同一笔手工调整会撞唯一键；带上时间戳让每次手工操作都是独立一笔
      refId: String(b.refId ?? Date.now()),
      remark,
      operatorId: ctx.state.platformAdmin?.adminId ?? null,
    })
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.ledger.manual', id,
      { bizType: b.bizType, amount, remark, duplicated: res.duplicated })
    ok(ctx, res)
  })

  router.put('/tenants/:id/account/credit', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const limit = Number((ctx.request.body as { creditLimit?: unknown }).creditLimit)
    if (!Number.isFinite(limit) || limit < 0) return fail(ctx, 400, '授信额度需为非负数字')
    await setCreditLimit(id, limit, ctx.state.platformAdmin?.adminId ?? null)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.credit', id, { creditLimit: limit })
    ok(ctx, await ensureAccount(id))
  })

  // ── 人工队列与催收 ──
  router.get('/manual-queue', read, async (ctx) => {
    ok(ctx, await listManualQueue(String(ctx.query.status ?? 'pending')))
  })

  router.put('/manual-queue/:id', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const b = ctx.request.body as { status?: string; note?: string }
    const status = b.status === 'rejected' ? 'rejected' : 'resolved'
    const done = await resolveManual(id, status, ctx.state.platformAdmin?.adminId ?? null, b.note ?? null)
    if (!done) return fail(ctx, 400, '该条已处理或不存在')
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.queue.resolve', null, { id, status })
    ok(ctx, { id, status })
  })

  router.post('/manual-queue', write, async (ctx) => {
    const b = ctx.request.body as { tenantId?: unknown; reason?: unknown; amount?: unknown }
    const tenantId = Number(b.tenantId)
    const reason = String(b.reason ?? '').trim()
    if (!tenantId || !reason) return fail(ctx, 400, 'tenantId 与 reason 必填')
    const created = await enqueueManual({
      tenantId, kind: 'settle_failed', refType: 'manual', refId: String(Date.now()),
      amount: Number(b.amount ?? 0), reason,
    })
    ok(ctx, { created })
  })

  // ── 平台总览 BI（P2-11）──
  // 只查平台库的汇总表，不实时跨库 UNION：一个租户库慢会拖垮整页
  router.get('/overview', read, async (ctx) => {
    const to = String(ctx.query.to ?? statDate(0))
    const from = String(ctx.query.from ?? statDate(-6))
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return fail(ctx, 400, '日期格式需为 YYYY-MM-DD')
    ok(ctx, {
      period: { from, to },
      tenants: await tenantOverview(from, to),
      trend: await platformTrend(from, to),
    })
  })

  router.post('/overview/refresh', write, async (ctx) => {
    await runPlatformBi(ctx.state.env)
    ok(ctx, { ok: true })
  })

  // ── 租户支付通道（P2-7 / P2-8）──
  //
  // channel_code 必须与订单表里的 channel 值完全一致（如 unispay_dana），
  // 对不上等于这条登记不生效：归属、费率、凭据全部落空，而账单照样出得来。
  router.get('/tenants/:id/channels', read, async (ctx) => {
    const id = Number(ctx.params.id)
    const [rows] = await getPlatformPool().query<RowDataPacket[]>(
      `SELECT id, channel_code, owner, fee_rate_pct, fee_fixed, merchant_no,
              credential_cipher, credential_iv, enabled, sort_order
         FROM pf_tenant_channel WHERE tenant_id = ? ORDER BY sort_order, channel_code`, [id])
    ok(ctx, {
      credentialKeyReady: hasCredentialKey(),
      channels: rows.map((r) => {
        let masked: string | null = null
        if (r.credential_cipher && r.credential_iv) {
          // 解不开就显式说「解不开」：静默显示未配置会让人以为要重新填，
          // 而真正的原因是换过密钥
          try { masked = maskSecret(openSecret(String(r.credential_cipher), String(r.credential_iv))) }
          catch { masked = '（无法解密，可能换过密钥）' }
        }
        return {
          id: r.id,
          channelCode: r.channel_code,
          owner: r.owner,
          feeRatePct: Number(r.fee_rate_pct),
          feeFixed: Number(r.fee_fixed),
          merchantNo: r.merchant_no,
          credentialMasked: masked,
          enabled: r.enabled === 1,
          sortOrder: Number(r.sort_order),
        }
      }),
    })
  })

  router.put('/tenants/:id/channels/:code', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const code = String(ctx.params.code).trim()
    if (!/^[a-z0-9_]{2,32}$/.test(code)) return fail(ctx, 400, '通道代号只允许小写字母、数字与下划线')
    const b = ctx.request.body as Record<string, unknown>
    const owner = b.owner === 'tenant' ? 'tenant' : 'platform'
    const feeRate = Number(b.feeRatePct ?? 0)
    const feeFixed = Number(b.feeFixed ?? 0)
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 100) return fail(ctx, 400, '通道费率需在 0~100 之间')
    if (!Number.isFinite(feeFixed) || feeFixed < 0) return fail(ctx, 400, '每笔固定手续费不能为负')

    let cipher: string | null = null
    let iv: string | null = null
    const secret = typeof b.credential === 'string' ? b.credential.trim() : ''
    if (secret) {
      if (!hasCredentialKey()) return fail(ctx, 400, '服务端未配置 TENANT_CREDENTIAL_KEY，拒绝存储凭据')
      const sealed = sealSecret(secret)
      cipher = sealed.cipher
      iv = sealed.iv
    }

    await getPlatformPool().execute(
      `INSERT INTO pf_tenant_channel
         (tenant_id, channel_code, owner, fee_rate_pct, fee_fixed, merchant_no,
          credential_cipher, credential_iv, enabled, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         owner = VALUES(owner), fee_rate_pct = VALUES(fee_rate_pct), fee_fixed = VALUES(fee_fixed),
         merchant_no = VALUES(merchant_no), enabled = VALUES(enabled), sort_order = VALUES(sort_order),
         -- 凭据留空表示不改：编辑费率时不该被迫重新粘一遍密钥
         credential_cipher = COALESCE(VALUES(credential_cipher), credential_cipher),
         credential_iv = COALESCE(VALUES(credential_iv), credential_iv)`,
      [id, code, owner, feeRate, feeFixed, b.merchantNo ? String(b.merchantNo) : null,
       cipher, iv, b.enabled === false ? 0 : 1, Number(b.sortOrder ?? 100)])

    await invalidateChannelOwnershipCache(ctx.state.env, id)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.channel.upsert', id,
      { code, owner, feeRate, feeFixed, credentialChanged: Boolean(secret) })
    ok(ctx, { tenantId: id, channelCode: code })
  })

  router.delete('/tenants/:id/channels/:code', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const code = String(ctx.params.code)
    await getPlatformPool().execute(
      'DELETE FROM pf_tenant_channel WHERE tenant_id = ? AND channel_code = ?', [id, code])
    await invalidateChannelOwnershipCache(ctx.state.env, id)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.channel.delete', id, { code })
    ok(ctx, { code })
  })

  // ── 混用模式对账（P2-9）──
  router.get('/reconcile', read, async (ctx) => {
    const to = String(ctx.query.to ?? statDate(-1))
    const from = String(ctx.query.from ?? statDate(-30))
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return fail(ctx, 400, '日期格式需为 YYYY-MM-DD')
    const tenantId = ctx.query.tenantId ? Number(ctx.query.tenantId) : undefined
    ok(ctx, { period: { from, to }, rows: await reconcileByMode(from, to, tenantId) })
  })

  router.get('/dunning/policy', read, async (ctx) => {
    ok(ctx, policyFromEnv())
  })

  // 手动触发一轮催收判定。定时任务每天跑，这里给的是「改完授信想立刻看效果」的入口
  router.post('/dunning/run', write, async (ctx) => {
    const actions = await runDunning(ctx.state.env)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'billing.dunning.run', null, { actions })
    ok(ctx, { actions })
  })

  return router
}
