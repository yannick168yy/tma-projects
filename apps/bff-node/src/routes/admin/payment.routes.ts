import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import {
  listChannels, createChannel, updateChannel, deleteChannel,
  createRule, updateRule, deleteRule, type FeeType, type TxType,
} from '../../services/payment-channel.service.js'
import { getAccounting, getBalances, refreshBalances } from '../../services/payment-accounting.service.js'
import { writeAuditLog } from '../../services/admin-store.js'
import { requireRole } from '../../middleware/require-role.js'

const router = new Router({ prefix: '/payment' })
const FEE_TYPES: FeeType[] = ['none', 'percent', 'fixed']

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
    enabled?: unknown; sortOrder?: unknown
  }
  if (!body.name || !body.provider || !body.label) {
    fail(ctx, 400, 'name / provider / label 必填'); return
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
    enabled: body.enabled !== false,
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
    enabled?: unknown; sortOrder?: unknown
  }
  const data: Parameters<typeof updateChannel>[2] = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.provider !== undefined) data.provider = String(body.provider).trim()
  if (body.label !== undefined) data.label = String(body.label).trim()
  if (body.category !== undefined) data.category = body.category === 'crypto' ? 'crypto' : 'fiat'
  if (body.depositFeeType !== undefined) data.depositFeeType = normalizeFeeType(body.depositFeeType)
  if (body.depositFeeValue !== undefined) data.depositFeeValue = Number(body.depositFeeValue)
  if (body.withdrawFeeType !== undefined) data.withdrawFeeType = normalizeFeeType(body.withdrawFeeType)
  if (body.withdrawFeeValue !== undefined) data.withdrawFeeValue = Number(body.withdrawFeeValue)
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled)
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
  const q = ctx.query as { from?: string; to?: string }
  const data = await getAccounting(ctx.state.env, { from: q.from, to: q.to })
  ok(ctx, data)
})

router.get('/balance', async (ctx) => {
  ok(ctx, await getBalances(ctx.state.env))
})

router.post('/balance/refresh', async (ctx) => {
  ok(ctx, await refreshBalances(ctx.state.env))
})

// ── 规则管理 ──────────────────────────────────────────────────────────────────

const TX_TYPES: TxType[] = ['deposit', 'withdraw', 'both']

function normalizeFeeType(v: unknown): FeeType {
  return FEE_TYPES.includes(v as FeeType) ? v as FeeType : 'none'
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
