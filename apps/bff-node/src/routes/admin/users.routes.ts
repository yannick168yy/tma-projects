import Router from '@koa/router'
import { listAdminUsers, writeAuditLog, updateUserLabel, getLoginLogs, getBetOrders, getOpPasswordHash } from '../../services/admin-store.js'
import { getUser, saveUser, getWallet, getWalletBalances, listLedger, adminAdjustBalance, getKyc, setUserKycOverride, listUserIdentities, reassignIdentity } from '../../services/store/index.js'
import { buildKycStatusResponse, getKycStepConfig } from '../../services/kyc.service.js'
import { verifyPassword } from '../../services/admin-auth.service.js'
import { hashPassword } from '../../utils/password.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { getUserTotalTurnover, getLevelThresholds, resolveLevel } from '../../services/rebate.service.js'
import { fail, ok } from '../../utils/response.js'
import { promoLabel } from './promotions.routes.js'
import type { RowDataPacket, OkPacket } from 'mysql2/promise'
import type { IdentityProvider } from '../../types/domain.js'
import type { Context } from 'koa'

const router = new Router({ prefix: '/users' })

function pageParams(ctx: Context) {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(200, Math.max(1, Number(ctx.query.pageSize ?? 20)))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(1000, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const search = ctx.query.search ? String(ctx.query.search) : undefined
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  const result = await listAdminUsers(ctx.state.env, { page, pageSize, search, status })
  ok(ctx, result)
})

router.get('/:id', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.params.id)
  if (!user) { fail(ctx, 404, 'User not found', 404); return }
  const [wallet, walletBalances, ledger, loginLogs, betOrders, kyc, systemCfg, effectiveCfg, totalTurnover, thresholds, identities] = await Promise.all([
    getWallet(ctx.state.redis, ctx.params.id),
    getWalletBalances(ctx.state.redis, ctx.params.id),
    listLedger(ctx.state.redis, ctx.params.id, 20),
    getLoginLogs(ctx.state.env, ctx.params.id, 20),
    getBetOrders(ctx.state.env, ctx.params.id, 30),
    getKyc(ctx.state.redis, ctx.params.id),
    getKycStepConfig(ctx.state.redis, ctx.state.env),
    getKycStepConfig(ctx.state.redis, ctx.state.env, ctx.params.id),
    getUserTotalTurnover(ctx.state.env, ctx.params.id, 'PHP'),
    getLevelThresholds(ctx.state.env, 'PHP'),
    listUserIdentities(ctx.state.redis, ctx.params.id),
  ])
  const telegram = identities.find((i) => i.provider === 'telegram') ?? identities.find((i) => i.provider === 'telegram_oidc')
  const google = identities.find((i) => i.provider === 'google')
  const phone = identities.find((i) => i.provider === 'phone')
  ok(ctx, {
    user: {
      ...user,
      telegramUserId: telegram?.provider === 'telegram' ? Number(telegram.identifier) : null,
      telegramUsername: telegram?.displayLabel ?? null,
      googleEmail: google?.displayLabel ?? user.email ?? null,
      phone: phone?.displayLabel ?? phone?.identifier ?? null,
    },
    level: resolveLevel(thresholds, totalTurnover),
    totalTurnover,
    wallet,
    walletBalances: walletBalances.length ? walletBalances : [{ currency: 'PHP', available: wallet.available, frozen: wallet.frozen }],
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

// 用户详情各记录 Tab 的分页查询
router.get('/:id/ledger', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [], total: 0, page: 1, pageSize: 20 }); return }
  const { page, pageSize, offset } = pageParams(ctx)
  const pool = getMysqlPool(ctx.state.env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, type, currency, amount, balance_after, description, created_at
     FROM bg_wallet_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [ctx.params.id, pageSize, offset],
  )
  const [[c]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_wallet_ledger WHERE user_id = ?`, [ctx.params.id],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      currency: String(r.currency ?? 'PHP'),
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      description: String(r.description ?? ''),
      createdAt: new Date(r.created_at as Date).toISOString(),
    })),
    total: Number(c?.total ?? 0), page, pageSize,
  })
})

router.get('/:id/login-logs', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [], total: 0, page: 1, pageSize: 20 }); return }
  const { page, pageSize, offset } = pageParams(ctx)
  const pool = getMysqlPool(ctx.state.env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, ip, region, user_agent, auth_method, entry_source, device_id, fp_visitor, created_at
     FROM bg_login_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [ctx.params.id, pageSize, offset],
  )
  const [[c]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_login_log WHERE user_id = ?`, [ctx.params.id],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      id: Number(r.id),
      ip: r.ip ? String(r.ip) : null,
      region: r.region ? String(r.region) : null,
      userAgent: r.user_agent ? String(r.user_agent) : null,
      authMethod: String(r.auth_method),
      entrySource: r.entry_source ? String(r.entry_source) : null,
      deviceId: r.device_id ? String(r.device_id) : null,
      fpVisitor: r.fp_visitor ? String(r.fp_visitor) : null,
      createdAt: new Date(r.created_at as Date).toISOString(),
    })),
    total: Number(c?.total ?? 0), page, pageSize,
  })
})

// 按局聚合：一局的 bet/win/refund 合成一行，无局号的单以 provider_txn_id 作独立一局
router.get('/:id/bet-orders', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [], total: 0, page: 1, pageSize: 20 }); return }
  const { page, pageSize, offset } = pageParams(ctx)
  const pool = getMysqlPool(ctx.state.env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.round_id, r.currency_code, r.provider_id,
            r.bet_amount, r.win_amount, r.cancel_count, r.bet_time, r.win_time,
            (SELECT COALESCE(o.name_override, g.name_en, g.name_zh)
               FROM bg_568win_game g
               LEFT JOIN bg_568win_game_override o
                 ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
              WHERE g.game_id = r.provider_id LIMIT 1) AS game_name,
            (SELECT COALESCE(g.provider, '568Win') FROM bg_568win_game g
              WHERE g.game_id = r.provider_id LIMIT 1) AS provider_name
     FROM (
       SELECT COALESCE(b.round_id, b.provider_txn_id) AS round_id,
         b.currency_code, MIN(b.provider_id) AS provider_id,
         SUM(CASE WHEN b.bet_type='bet' THEN b.amount ELSE 0 END) AS bet_amount,
         SUM(CASE WHEN b.bet_type IN ('win','refund') THEN b.amount ELSE 0 END) AS win_amount,
         SUM(CASE WHEN b.bet_type='cancel' THEN 1 ELSE 0 END)     AS cancel_count,
         MIN(CASE WHEN b.bet_type='bet' THEN b.created_at END)    AS bet_time,
         MIN(CASE WHEN b.bet_type IN ('win','refund') THEN b.created_at END) AS win_time
       FROM bg_bet_order b WHERE b.user_id = ?
       GROUP BY COALESCE(b.round_id, b.provider_txn_id), b.currency_code
     ) r
     ORDER BY COALESCE(r.bet_time, r.win_time) DESC LIMIT ? OFFSET ?`,
    [ctx.params.id, pageSize, offset],
  )
  const [[c]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (
       SELECT 1 FROM bg_bet_order WHERE user_id = ?
       GROUP BY COALESCE(round_id, provider_txn_id), currency_code
     ) sub`,
    [ctx.params.id],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      roundId: String(r.round_id),
      currencyCode: String(r.currency_code ?? 'PHP'),
      betAmount: Number(r.bet_amount),
      winAmount: Number(r.win_amount),
      cancelled: Number(r.cancel_count) > 0,
      gameName: r.game_name ? String(r.game_name) : null,
      providerName: r.provider_name ? String(r.provider_name) : null,
      betTime: r.bet_time ? new Date(r.bet_time as Date).toISOString() : null,
      winTime: r.win_time ? new Date(r.win_time as Date).toISOString() : null,
    })),
    total: Number(c?.total ?? 0), page, pageSize,
  })
})

router.get('/:id/promo-claims', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [], total: 0, page: 1, pageSize: 20 }); return }
  const { page, pageSize, offset } = pageParams(ctx)
  const pool = getMysqlPool(ctx.state.env)
  // ref_type='game' 是 568Win 游戏内派彩(Bonus 回调)写入的,厂商报文里 IsGameProviderPromotion=false,
  // 并非平台优惠(且大量金额为 0 的每局结算),此处只展示真·优惠(promo/红包等)。
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, type, description, amount, currency, created_at
     FROM bg_wallet_ledger
     WHERE user_id = ? AND type IN ('red_packet', 'bonus') AND COALESCE(ref_type, '') <> 'game'
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [ctx.params.id, pageSize, offset],
  )
  const [[c]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_wallet_ledger WHERE user_id = ? AND type IN ('red_packet', 'bonus') AND COALESCE(ref_type, '') <> 'game'`,
    [ctx.params.id],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      id: String(r.id),
      promoName: promoLabel(String(r.type), String(r.description ?? '')),
      type: String(r.type),
      description: String(r.description ?? ''),
      amount: Number(r.amount),
      currency: String(r.currency ?? 'PHP'),
      claimedAt: new Date(r.created_at as Date).toISOString(),
    })),
    total: Number(c?.total ?? 0), page, pageSize,
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

router.post('/:id/reset-password', async (ctx) => {
  const body = ctx.request.body as { provider?: string; password?: string; opPassword?: string }
  if (body.provider !== 'phone') {
    fail(ctx, 400, 'provider must be phone'); return
  }
  if (!body.password || body.password.length < 8) {
    fail(ctx, 400, 'Password must be at least 8 characters'); return
  }
  if (!body.opPassword) {
    fail(ctx, 400, 'opPassword is required'); return
  }

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

  const provider = body.provider as IdentityProvider
  const identities = await listUserIdentities(ctx.state.redis, ctx.params.id)
  const identity = identities.find((i) => i.provider === provider)
  if (!identity) {
    fail(ctx, 404, 'Identity not found', 404); return
  }

  await reassignIdentity(ctx.state.redis, {
    ...identity,
    credentialHash: await hashPassword(body.password),
  })
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'user.password_reset',
    targetType: 'user',
    targetId: user.id,
    detail: { provider },
    ip: ctx.ip,
  })
  ok(ctx, { success: true })
})

const SUPPORTED_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TRX_TESTNET']

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
  const allowed = ['normal', 'arbitrage', 'test']
  if (!body.label || !allowed.includes(body.label)) {
    fail(ctx, 400, 'label must be normal | arbitrage | test'); return
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
