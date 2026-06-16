import Router from '@koa/router'
import { listAdminUsers, writeAuditLog, updateUserLabel, getLoginLogs, getBetOrders, getOpPasswordHash } from '../../services/admin-store.js'
import { getUser, saveUser, getWallet, listLedger, adminAdjustBalance, getKyc, setUserKycOverride } from '../../services/store/index.js'
import { buildKycStatusResponse, getKycStepConfig } from '../../services/kyc.service.js'
import { verifyPassword } from '../../services/admin-auth.service.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { getUserTotalTurnover, getLevelThresholds, resolveLevel } from '../../services/rebate.service.js'
import { fail, ok } from '../../utils/response.js'
import type { RowDataPacket, OkPacket } from 'mysql2/promise'

const router = new Router({ prefix: '/users' })

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const search = ctx.query.search ? String(ctx.query.search) : undefined
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  const result = await listAdminUsers(ctx.state.env, { page, pageSize, search, status })
  ok(ctx, result)
})

router.get('/:id', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }
  const [wallet, ledger, loginLogs, betOrders, kyc, systemCfg, effectiveCfg, totalTurnover, thresholds] = await Promise.all([
    getWallet(ctx.state.redis, ctx.params.id),
    listLedger(ctx.state.redis, ctx.params.id, 20),
    getLoginLogs(ctx.state.env, ctx.params.id, 20),
    getBetOrders(ctx.state.env, ctx.params.id, 30),
    getKyc(ctx.state.redis, ctx.params.id),
    getKycStepConfig(ctx.state.redis, ctx.state.env),
    getKycStepConfig(ctx.state.redis, ctx.state.env, ctx.params.id),
    getUserTotalTurnover(ctx.state.env, ctx.params.id),
    getLevelThresholds(ctx.state.env),
  ])
  ok(ctx, {
    user,
    level: resolveLevel(thresholds, totalTurnover),
    totalTurnover,
    wallet,
    ledger,
    loginLogs,
    betOrders,
    kycConfig: {
      system: systemCfg,
      effective: effectiveCfg,
      docOverride: user.kycDocOverride ?? null,
      faceOverride: user.kycFaceOverride ?? null,
    },
    kyc: kyc ? {
      ...buildKycStatusResponse(kyc),
      extractedIdNo: kyc.extractedIdNo ?? null,
      docSubmittedAt: kyc.docSubmittedAt ?? null,
      faceSubmittedAt: kyc.faceSubmittedAt ?? null,
      reviewedAt: kyc.reviewedAt ?? null,
    } : null,
  })
})

// 三态：'inherit'=跟随系统(null) | 'on'=强制开(true) | 'off'=强制关(false)
function parseOverride(v: unknown): boolean | null | undefined {
  if (v === 'inherit') return null
  if (v === 'on') return true
  if (v === 'off') return false
  return undefined
}

router.patch('/:id/kyc-override', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }

  const body = ctx.request.body as { requireDocument?: string; requireFace?: string }
  const doc = parseOverride(body.requireDocument)
  const face = parseOverride(body.requireFace)
  if (doc === undefined || face === undefined) {
    fail(ctx, 400, 'requireDocument / requireFace 必须为 inherit | on | off'); return
  }

  await setUserKycOverride(ctx.state.redis, ctx.params.id, doc, face)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.kyc_override',
    targetType: 'user',
    targetId: ctx.params.id,
    detail: { requireDocument: body.requireDocument, requireFace: body.requireFace },
    ip: ctx.ip,
  })
  const effective = await getKycStepConfig(ctx.state.redis, ctx.state.env, ctx.params.id)
  ok(ctx, { docOverride: doc, faceOverride: face, effective })
})

router.patch('/:id/status', async (ctx) => {
  const body = ctx.request.body as { status?: string; reason?: string }
  const allowed = ['active', 'frozen', 'banned']
  if (!body.status || !allowed.includes(body.status)) {
    fail(ctx, 400, 'status must be active | frozen | banned'); return
  }
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }

  const prev = user.status
  user.status = body.status as typeof user.status
  user.statusReason = body.reason ?? undefined
  await saveUser(ctx.state.redis, user)

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.status_change',
    targetType: 'user',
    targetId: user.id,
    detail: { from: prev, to: body.status, reason: body.reason },
    ip: ctx.ip,
  })
  ok(ctx, { status: user.status })
})

const SUPPORTED_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TON', 'TRX', 'TRX_TESTNET', 'BNB', 'ETH', 'BTC']

router.post('/:id/adjust-balance', async (ctx) => {
  const body = ctx.request.body as { amount?: number; note?: string; opPassword?: string; currency?: string }
  if (typeof body.amount !== 'number' || body.amount === 0) {
    fail(ctx, 400, 'amount must be a non-zero number'); return
  }
  if (!body.opPassword) {
    fail(ctx, 400, 'opPassword is required'); return
  }
  const currency = body.currency ?? 'PHP'
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    fail(ctx, 400, `Unsupported currency: ${currency}`); return
  }

  // 验证操作密码
  const opHash = await getOpPasswordHash(ctx.state.env)
  if (!opHash) {
    fail(ctx, 403, 'Operation password not configured. Please ask super_admin to set it first.'); return
  }
  const valid = await verifyPassword(body.opPassword, opHash)
  if (!valid) {
    fail(ctx, 403, 'Incorrect operation password'); return
  }

  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }

  let result: { available: number; orderId: string }
  try {
    result = await adminAdjustBalance(
      ctx.state.redis,
      ctx.params.id,
      body.amount,
      {
        adminUsername: ctx.state.adminUsername!,
        note: body.note,
        traceId: ctx.state.traceId,
        currency,
      },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Adjustment failed'
    fail(ctx, 400, msg); return
  }

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.balance_adjust',
    targetType: 'user',
    targetId: user.id,
    detail: { amount: body.amount, currency, note: body.note, orderId: result.orderId, balanceAfter: result.available },
    ip: ctx.ip,
  })
  ok(ctx, { available: result.available, orderId: result.orderId })
})

router.patch('/:id/profile', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }
  const body = ctx.request.body as Partial<typeof user.profile>
  const prev = { ...user.profile }
  user.profile = { ...user.profile, ...body }
  await saveUser(ctx.state.redis, user)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.profile_edit',
    targetType: 'user',
    targetId: user.id,
    detail: { before: prev, after: user.profile },
    ip: ctx.ip,
  })
  ok(ctx, { profile: user.profile })
})

router.get('/:id/turnover', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, { canWithdraw: true, totalRemaining: 0, requirements: [] }); return
  }
  const pool = getMysqlPool(ctx.state.env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, source_type, source_ref, required_amount, completed_amount,
            status, expires_at, created_at, updated_at
     FROM bg_turnover_requirements
     WHERE user_id = ?
     ORDER BY FIELD(status,'pending','completed','expired','cancelled'), created_at ASC`,
    [ctx.params.id],
  )
  const requirements = rows.map((r) => ({
    id: Number(r.id),
    sourceType: r.source_type as string,
    sourceRef: String(r.source_ref),
    requiredAmount: Number(r.required_amount),
    completedAmount: Number(r.completed_amount),
    status: r.status as string,
    expiresAt: r.expires_at ? new Date(r.expires_at as Date).toISOString() : null,
    createdAt: new Date(r.created_at as Date).toISOString(),
    updatedAt: new Date(r.updated_at as Date).toISOString(),
  }))
  const pending = requirements.filter((r) => r.status === 'pending')
  const totalRemaining = Math.max(0, pending.reduce((s, r) => s + (r.requiredAmount - r.completedAmount), 0))
  ok(ctx, { canWithdraw: totalRemaining <= 0, totalRemaining, requirements })
})

router.patch('/:id/turnover/:reqId', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    fail(ctx, 503, 'MySQL not enabled'); return
  }
  const body = ctx.request.body as { action: string; completedAmount?: number; reason?: string }
  const reqId = Number(ctx.params.reqId)
  if (!body.action || !['adjust', 'cancel'].includes(body.action)) {
    fail(ctx, 400, 'action must be adjust | cancel'); return
  }
  const pool = getMysqlPool(ctx.state.env)
  const [[req]] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, status, required_amount FROM bg_turnover_requirements WHERE id = ? AND user_id = ?`,
    [reqId, ctx.params.id],
  )
  if (!req) { fail(ctx, 404, 'Requirement not found', 404); return }
  if (req.status === 'expired' || req.status === 'cancelled') {
    fail(ctx, 400, `Cannot modify a ${req.status as string} requirement`); return
  }

  if (body.action === 'cancel') {
    await pool.execute(
      `UPDATE bg_turnover_requirements SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
      [reqId],
    )
  } else {
    const newCompleted = Number(body.completedAmount ?? 0)
    if (newCompleted < 0 || newCompleted > Number(req.required_amount)) {
      fail(ctx, 400, `completedAmount must be between 0 and ${Number(req.required_amount)}`); return
    }
    const newStatus = newCompleted >= Number(req.required_amount) ? 'completed' : 'pending'
    await pool.execute(
      `UPDATE bg_turnover_requirements SET completed_amount = ?, status = ?, updated_at = NOW() WHERE id = ?`,
      [newCompleted, newStatus, reqId],
    )
  }

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.turnover_adjust',
    targetType: 'user',
    targetId: ctx.params.id,
    detail: { reqId, action: body.action, completedAmount: body.completedAmount, reason: body.reason },
    ip: ctx.ip,
  })
  ok(ctx, { success: true })
})

router.patch('/:id/label', async (ctx) => {
  const body = ctx.request.body as { label?: string }
  const allowed = ['normal', 'arbitrage']
  if (!body.label || !allowed.includes(body.label)) {
    fail(ctx, 400, 'label must be normal | arbitrage'); return
  }
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }
  await updateUserLabel(ctx.state.env, ctx.params.id, body.label)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.label_change',
    targetType: 'user',
    targetId: ctx.params.id,
    detail: { label: body.label },
    ip: ctx.ip,
  })
  ok(ctx, { label: body.label })
})

export default router
