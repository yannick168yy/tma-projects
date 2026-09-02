import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { ok, fail } from '../../utils/response.js'
import {
  listChannels, createChannel, updateChannel, deleteChannel,
  createRule, updateRule, deleteRule, type FeeType, type TxType,
} from '../../services/payment-channel.service.js'
import {
  getAccounting, getBalances, refreshBalances,
  setAlertThreshold, setManualProviderBalance, getPaymentReconciliation, ALERT_PROVIDERS,
} from '../../services/payment-accounting.service.js'
import { writeAuditLog } from '../../services/admin-store.js'
import { requireRole } from '../../middleware/require-role.js'
import { queryDeposit as queryUnispayDeposit, queryWithdrawal as queryUnispayWithdrawal, UnispayError } from '../../services/unispay.service.js'

const router = new Router({ prefix: '/payment' })
const FEE_TYPES: FeeType[] = ['none', 'percent', 'fixed']
const REMOVED_PAYMENT_PROVIDERS = new Set(['beepay'])

// ── 渠道管理 ──────────────────────────────────────────────────────────────────

router.get('/channels', async (ctx) => {
  const channels = await listChannels(ctx.state.env)
  ok(ctx, channels)
})

router.post('/channels', requireRole('super_admin'), async (ctx) => {
  const body = ctx.request.body as {
    name?: string; provider?: string; label?: string; category?: string
    depositFeeType?: string; depositFeeValue?: unknown
    withdrawFeeType?: string; withdrawFeeValue?: unknown
    withdrawMin?: unknown; withdrawMax?: unknown; withdrawGasFee?: unknown
    withdrawGasDiscountThreshold?: unknown; withdrawGasDiscountFee?: unknown
    enabled?: unknown; clientVisible?: unknown; sortOrder?: unknown
  }
  if (!body.name || !body.provider || !body.label) {
    fail(ctx, 400, 'name / provider / label 必填'); return
  }
  if (REMOVED_PAYMENT_PROVIDERS.has(String(body.provider).trim().toLowerCase())) {
    fail(ctx, 400, '该支付服务商已停用'); return
  }
  const id = await createChannel(ctx.state.env, {
    name: String(body.name).trim(),
    provider: String(body.provider).trim(),
    label: String(body.label).trim(),
    category: body.category === 'crypto' ? 'crypto' : 'fiat',
    depositFeeType: normalizeFeeType(body.depositFeeType),
    depositFeeValue: Number(body.depositFeeValue ?? 0),
    withdrawFeeType: normalizeFeeType(body.withdrawFeeType),
    withdrawFeeValue: Number(body.withdrawFeeValue ?? 0),
    withdrawMin: parseAmount(body.withdrawMin),
    withdrawMax: parseAmount(body.withdrawMax),
    withdrawGasFee: parseAmount(body.withdrawGasFee) ?? 0,
    withdrawGasDiscountThreshold: parseAmount(body.withdrawGasDiscountThreshold),
    withdrawGasDiscountFee: parseAmount(body.withdrawGasDiscountFee),
    enabled: body.enabled !== false,
    clientVisible: body.clientVisible !== false,
    sortOrder: Number(body.sortOrder ?? 0),
  })
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'payment_channel_create', targetType: 'payment_channel', targetId: String(id),
    detail: body, ip: ctx.ip,
  })
  ok(ctx, { id })
})

router.put('/channels/:id', requireRole('super_admin'), async (ctx) => {
  const id = Number(ctx.params.id)
  const body = ctx.request.body as {
    name?: string; provider?: string; label?: string; category?: string
    depositFeeType?: string; depositFeeValue?: unknown
    withdrawFeeType?: string; withdrawFeeValue?: unknown
    withdrawMin?: unknown; withdrawMax?: unknown; withdrawGasFee?: unknown
    withdrawGasDiscountThreshold?: unknown; withdrawGasDiscountFee?: unknown
    enabled?: unknown; clientVisible?: unknown; sortOrder?: unknown
  }
  const data: Parameters<typeof updateChannel>[2] = {}
  if (body.provider !== undefined && REMOVED_PAYMENT_PROVIDERS.has(String(body.provider).trim().toLowerCase())) {
    fail(ctx, 400, '该支付服务商已停用'); return
  }
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.provider !== undefined) data.provider = String(body.provider).trim()
  if (body.label !== undefined) data.label = String(body.label).trim()
  if (body.category !== undefined) data.category = body.category === 'crypto' ? 'crypto' : 'fiat'
  if (body.depositFeeType !== undefined) data.depositFeeType = normalizeFeeType(body.depositFeeType)
  if (body.depositFeeValue !== undefined) data.depositFeeValue = Number(body.depositFeeValue)
  if (body.withdrawFeeType !== undefined) data.withdrawFeeType = normalizeFeeType(body.withdrawFeeType)
  if (body.withdrawFeeValue !== undefined) data.withdrawFeeValue = Number(body.withdrawFeeValue)
  if ('withdrawMin' in body) data.withdrawMin = parseAmount(body.withdrawMin)
  if ('withdrawMax' in body) data.withdrawMax = parseAmount(body.withdrawMax)
  if ('withdrawGasFee' in body) data.withdrawGasFee = parseAmount(body.withdrawGasFee) ?? 0
  if ('withdrawGasDiscountThreshold' in body) data.withdrawGasDiscountThreshold = parseAmount(body.withdrawGasDiscountThreshold)
  if ('withdrawGasDiscountFee' in body) data.withdrawGasDiscountFee = parseAmount(body.withdrawGasDiscountFee)
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled)
  if (body.clientVisible !== undefined) data.clientVisible = Boolean(body.clientVisible)
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder)
  const updated = await updateChannel(ctx.state.env, id, data)
  if (!updated) { fail(ctx, 404, '渠道不存在'); return }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'payment_channel_update', targetType: 'payment_channel', targetId: String(id),
    detail: body, ip: ctx.ip,
  })
  ok(ctx, null)
})

router.delete('/channels/:id', requireRole('super_admin'), async (ctx) => {
  const id = Number(ctx.params.id)
  const deleted = await deleteChannel(ctx.state.env, id)
  if (!deleted) { fail(ctx, 404, '渠道不存在'); return }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'payment_channel_delete', targetType: 'payment_channel', targetId: String(id),
    detail: {}, ip: ctx.ip,
  })
  ok(ctx, null)
})

// ── 记账：代收 / 代付汇总 + 服务商余额 ─────────────────────────────────────────

router.get('/accounting', async (ctx) => {
  const q = ctx.query as { from?: string; to?: string; currency?: string }
  const data = await getAccounting(ctx.state.env, { from: q.from, to: q.to, currency: q.currency })
  ok(ctx, data)
})

router.get('/reconciliation', async (ctx) => {
  const provider = String(ctx.query.provider ?? 'unispay')
  const currency = String(ctx.query.currency ?? 'IDR')
  ok(ctx, await getPaymentReconciliation(ctx.state.env, provider, currency))
})

router.post('/reconciliation/unispay/sync', requireRole('super_admin'), async (ctx) => {
  const body = ctx.request.body as { source?: string; orderId?: string }
  const source = body.source
  const orderId = String(body.orderId ?? '').trim()
  if ((source !== 'deposit' && source !== 'withdraw') || !orderId) {
    fail(ctx, 400, 'source / orderId 无效'); return
  }
  const db = getMysqlPool(ctx.state.env)
  const table = source === 'deposit' ? 'bg_deposit_order' : 'bg_withdraw_order'
  const [[order]] = await db.query<RowDataPacket[]>(
    `SELECT order_id, amount, status FROM ${table} WHERE order_id = ? AND channel LIKE 'unispay%' LIMIT 1`,
    [orderId],
  )
  if (!order) { fail(ctx, 404, 'UnisPay 订单不存在'); return }
  try {
    const queried = source === 'deposit'
      ? await queryUnispayDeposit(orderId, ctx.state.env)
      : await queryUnispayWithdrawal(orderId, ctx.state.env)
    const terminal = source === 'deposit'
      ? ['1', '2', '3'].includes(String(queried.state))
      : ['2', '3', '4'].includes(String(queried.state))
    if (terminal) {
      const res = await fetch(`${ctx.state.env.CORE_NODE_URL}/internal/payment/unispay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN },
        body: JSON.stringify({
          orderId,
          providerOrderId: queried.platformId,
          status: String(queried.state),
          amount: queried.amount || Number(order.amount),
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error(`core sync failed (${res.status})`)
    }
    const [[latest]] = await db.query<RowDataPacket[]>(`SELECT status FROM ${table} WHERE order_id = ? LIMIT 1`, [orderId])
    ok(ctx, { providerState: queried.state, localStatus: String(latest?.status ?? order.status), synced: terminal })
  } catch (err) {
    fail(ctx, 502, err instanceof UnispayError ? err.message : err instanceof Error ? err.message : 'UnisPay 查询失败')
  }
})

router.get('/balance', async (ctx) => {
  ok(ctx, await getBalances(ctx.state.env))
})

router.post('/balance/refresh', async (ctx) => {
  ok(ctx, await refreshBalances(ctx.state.env))
})

// 设置告警金额（0 = 关闭告警）
router.post('/balance/threshold', async (ctx) => {
  const body = ctx.request.body as { provider?: string; threshold?: unknown }
  const provider = String(body.provider ?? '')
  if (!ALERT_PROVIDERS.includes(provider)) { fail(ctx, 400, 'provider 非法'); return }
  const threshold = Number(body.threshold ?? 0)
  if (!Number.isFinite(threshold) || threshold < 0) { fail(ctx, 400, '告警金额非法'); return }
  await setAlertThreshold(ctx.state.env, provider, threshold)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'provider_balance_threshold_set', targetType: 'provider_balance', targetId: provider,
    detail: { threshold }, ip: ctx.ip,
  })
  ok(ctx, await getBalances(ctx.state.env))
})

// Matrix 手动登记余额（无余额查询 API）
router.post('/balance/matrix', async (ctx) => {
  const body = ctx.request.body as { balance?: unknown }
  const balance = Number(body.balance)
  if (!Number.isFinite(balance) || balance < 0) { fail(ctx, 400, '余额金额非法'); return }
  await setManualProviderBalance(ctx.state.env, 'matrix', balance)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'provider_balance_manual_set', targetType: 'provider_balance', targetId: 'matrix',
    detail: { balance }, ip: ctx.ip,
  })
  ok(ctx, await getBalances(ctx.state.env))
})

// ── 规则管理 ──────────────────────────────────────────────────────────────────

const TX_TYPES: TxType[] = ['deposit', 'withdraw', 'both']

function normalizeFeeType(v: unknown): FeeType {
  return FEE_TYPES.includes(v as FeeType) ? v as FeeType : 'none'
}

// 空 / null / 非法 → null（不限制）；否则转数字
function parseAmount(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

router.post('/channels/:channelId/rules', requireRole('super_admin'), async (ctx) => {
  const channelId = Number(ctx.params.channelId)
  const body = ctx.request.body as {
    currency?: string; txType?: string; amountMin?: unknown; amountMax?: unknown
    weight?: unknown; enabled?: unknown
  }
  const weight = Number(body.weight ?? 100)
  if (isNaN(weight) || weight <= 0) { fail(ctx, 400, 'weight 必须为正整数'); return }
  const txType = (body.txType ?? 'both') as TxType
  if (!TX_TYPES.includes(txType)) { fail(ctx, 400, 'txType 必须为 deposit / withdraw / both'); return }
  const id = await createRule(ctx.state.env, channelId, {
    currency: String(body.currency ?? 'PHP').toUpperCase(),
    txType,
    amountMin: body.amountMin !== undefined && body.amountMin !== null && body.amountMin !== '' ? Number(body.amountMin) : null,
    amountMax: body.amountMax !== undefined && body.amountMax !== null && body.amountMax !== '' ? Number(body.amountMax) : null,
    weight,
    enabled: body.enabled !== false,
  })
  ok(ctx, { id })
})

router.put('/rules/:id', requireRole('super_admin'), async (ctx) => {
  const id = Number(ctx.params.id)
  const body = ctx.request.body as {
    currency?: string; txType?: string; amountMin?: unknown; amountMax?: unknown
    weight?: unknown; enabled?: unknown
  }
  const data: Parameters<typeof updateRule>[2] = {}
  if (body.currency !== undefined) data.currency = String(body.currency).toUpperCase()
  if (body.txType !== undefined && TX_TYPES.includes(body.txType as TxType)) data.txType = body.txType as TxType
  if ('amountMin' in body) data.amountMin = body.amountMin !== null && body.amountMin !== '' ? Number(body.amountMin) : null
  if ('amountMax' in body) data.amountMax = body.amountMax !== null && body.amountMax !== '' ? Number(body.amountMax) : null
  if (body.weight !== undefined) data.weight = Number(body.weight)
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled)
  const updated = await updateRule(ctx.state.env, id, data)
  if (!updated) { fail(ctx, 404, '规则不存在'); return }
  ok(ctx, null)
})

router.delete('/rules/:id', requireRole('super_admin'), async (ctx) => {
  const id = Number(ctx.params.id)
  const deleted = await deleteRule(ctx.state.env, id)
  if (!deleted) { fail(ctx, 404, '规则不存在'); return }
  ok(ctx, null)
})

export default router
