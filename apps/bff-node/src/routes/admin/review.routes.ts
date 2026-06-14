import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { RULE_META, getReviewLog, getRelatedAccounts, rerunReview } from '../../services/withdraw-review.service.js'
import { writeAuditLog } from '../../services/admin-store.js'
import type { RowDataPacket } from 'mysql2/promise'

const router = new Router({ prefix: '/review' })

const ruleName = (code: string) => RULE_META[code]?.name ?? code

// ── 总览 ──────────────────────────────────────────────────────────────────────
router.get('/overview', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, { autoApproveRate: null, manualBacklog: 0, overdue: 0, totalReviewed7d: 0, topHits: [], trend: [] }); return
  }
  const pool = getMysqlPool(ctx.state.env)

  const [[agg]] = await pool.query<RowDataPacket[]>(
    `SELECT SUM(review_verdict='pass') AS pass_cnt, SUM(review_verdict='manual') AS manual_cnt
     FROM bg_withdraw_order WHERE reviewed_at > NOW() - INTERVAL 7 DAY`,
  )
  const passCnt = Number(agg?.pass_cnt ?? 0)
  const manualCnt = Number(agg?.manual_cnt ?? 0)
  const total = passCnt + manualCnt

  const [[bl]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS backlog,
       SUM(reviewed_at < NOW() - INTERVAL 6 HOUR) AS overdue
     FROM bg_withdraw_order WHERE status = 'pending' AND review_verdict = 'manual'`,
  )

  const [hitRows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, COUNT(*) AS cnt FROM bg_withdraw_review_log
     WHERE verdict = 'manual' AND created_at > NOW() - INTERVAL 7 DAY
     GROUP BY rule_code ORDER BY cnt DESC`,
  )
  const [trendRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE(reviewed_at) AS d,
            SUM(review_verdict='pass') AS pass_cnt,
            SUM(review_verdict='manual') AS manual_cnt
     FROM bg_withdraw_order WHERE reviewed_at > NOW() - INTERVAL 7 DAY
     GROUP BY DATE(reviewed_at) ORDER BY d ASC`,
  )

  ok(ctx, {
    autoApproveRate: total > 0 ? Math.round((passCnt / total) * 1000) / 10 : null,
    manualBacklog: Number(bl?.backlog ?? 0),
    overdue: Number(bl?.overdue ?? 0),
    totalReviewed7d: total,
    topHits: hitRows.map((r) => ({ ruleCode: String(r.rule_code), name: ruleName(String(r.rule_code)), count: Number(r.cnt) })),
    trend: trendRows.map((r) => ({ date: new Date(r.d as Date).toISOString().slice(0, 10), pass: Number(r.pass_cnt), manual: Number(r.manual_cnt) })),
  })
})

// ── 提案审核记录（全部）/ 待人工队列 ──────────────────────────────────────────
router.get('/proposals', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { total: 0, items: [] }); return }
  const pool = getMysqlPool(ctx.state.env)
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: unknown[] = []
  if (ctx.query.userId) { where.push('w.user_id = ?'); params.push(String(ctx.query.userId)) }
  if (ctx.query.status) { where.push('w.status = ?'); params.push(String(ctx.query.status)) }
  if (ctx.query.reviewVerdict === 'none') { where.push('w.review_verdict IS NULL') }
  else if (ctx.query.reviewVerdict) { where.push('w.review_verdict = ?'); params.push(String(ctx.query.reviewVerdict)) }
  // queue=manual：只看待人工（manual + pending）
  if (ctx.query.queue === 'manual') { where.push(`w.review_verdict = 'manual' AND w.status = 'pending'`) }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [[cnt]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_withdraw_order w ${whereClause}`, params,
  )
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT w.order_id, w.user_id, w.channel, w.currency, w.amount, w.status,
            w.review_verdict, w.reviewed_at, w.review_ms, w.handled_by, w.handled_at, w.created_at,
            u.display_name,
            hr.hit_rules
     FROM bg_withdraw_order w
     LEFT JOIN bg_user u ON u.id = w.user_id
     LEFT JOIN (
       SELECT l.order_id, GROUP_CONCAT(l.rule_code) AS hit_rules
       FROM bg_withdraw_review_log l
       WHERE l.verdict = 'manual'
         AND l.round = (SELECT MAX(l2.round) FROM bg_withdraw_review_log l2 WHERE l2.order_id = l.order_id)
       GROUP BY l.order_id
     ) hr ON hr.order_id = w.order_id
     ${whereClause}
     ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  ok(ctx, {
    total: Number(cnt?.total ?? 0),
    page, pageSize,
    items: rows.map((r) => ({
      orderId: String(r.order_id),
      userId: String(r.user_id),
      displayName: r.display_name ? String(r.display_name) : null,
      channelId: String(r.channel),
      currency: String(r.currency),
      amount: Number(r.amount),
      status: String(r.status),
      reviewVerdict: r.review_verdict ? String(r.review_verdict) : null,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as Date).toISOString() : null,
      reviewMs: r.review_ms == null ? null : Number(r.review_ms),
      handledBy: r.handled_by ? String(r.handled_by) : null,
      handledAt: r.handled_at ? new Date(r.handled_at as Date).toISOString() : null,
      createdAt: new Date(r.created_at as Date).toISOString(),
      hitRules: r.hit_rules ? String(r.hit_rules).split(',').map((c) => ({ code: c, name: ruleName(c) })) : [],
    })),
  })
})

// ── 提案详情（含审核快照 + 逐规则 + 辅助核查信息）─────────────────────────────
router.get('/proposals/:orderId', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { fail(ctx, 503, 'DB not available'); return }
  const pool = getMysqlPool(ctx.state.env)
  const orderId = ctx.params.orderId

  const [[w]] = await pool.query<RowDataPacket[]>(
    `SELECT w.*, u.display_name, u.status AS user_status, u.registered_at, u.inviter_id, u.email
     FROM bg_withdraw_order w LEFT JOIN bg_user u ON u.id = w.user_id
     WHERE w.order_id = ? LIMIT 1`,
    [orderId],
  )
  if (!w) { fail(ctx, 404, 'Order not found', 404); return }
  const userId = String(w.user_id)

  const [[wallet]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(available),0) AS available, COALESCE(SUM(frozen),0) AS frozen
     FROM bg_wallet WHERE user_id = ?`,
    [userId],
  )
  const [[kyc]] = await pool.query<RowDataPacket[]>(
    `SELECT status FROM bg_kyc WHERE user_id = ? LIMIT 1`, [userId],
  )

  const snapshot = w.review_snapshot
    ? (typeof w.review_snapshot === 'string' ? JSON.parse(w.review_snapshot) : w.review_snapshot)
    : null
  const [rules, related] = await Promise.all([
    getReviewLog(ctx.state.env, orderId),
    getRelatedAccounts(ctx.state.env, userId),
  ])

  ok(ctx, {
    order: {
      orderId: String(w.order_id),
      userId,
      channelId: String(w.channel),
      currency: String(w.currency),
      amount: Number(w.amount),
      status: String(w.status),
      reviewVerdict: w.review_verdict ? String(w.review_verdict) : null,
      reviewedAt: w.reviewed_at ? new Date(w.reviewed_at as Date).toISOString() : null,
      reviewRound: w.review_round == null ? null : Number(w.review_round),
      reviewMs: w.review_ms == null ? null : Number(w.review_ms),
      rejectReason: w.reject_reason ? String(w.reject_reason) : null,
      handledBy: w.handled_by ? String(w.handled_by) : null,
      handledAt: w.handled_at ? new Date(w.handled_at as Date).toISOString() : null,
      createdAt: new Date(w.created_at as Date).toISOString(),
    },
    user: {
      userId,
      displayName: w.display_name ? String(w.display_name) : null,
      status: w.user_status ? String(w.user_status) : null,
      email: w.email ? String(w.email) : null,
      registeredAt: w.registered_at ? new Date(w.registered_at as Date).toISOString() : null,
      inviterId: w.inviter_id ? String(w.inviter_id) : null,
      kycStatus: kyc?.status ? String(kyc.status) : null,
      walletAvailable: Number(wallet?.available ?? 0),
      walletFrozen: Number(wallet?.frozen ?? 0),
    },
    snapshot,
    rules,
    related,
  })
})

// ── 人工重跑审核 ──────────────────────────────────────────────────────────────
router.post('/proposals/:orderId/rerun', async (ctx) => {
  const result = await rerunReview(ctx.state.env, ctx.state.redis, ctx.params.orderId)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'review.rerun', targetType: 'withdrawal', targetId: ctx.params.orderId,
    detail: { round: result.round }, ip: ctx.ip,
  })
  ok(ctx, result)
})

// ── 规则配置 ──────────────────────────────────────────────────────────────────
router.get('/config', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { config: [] }); return }
  const pool = getMysqlPool(ctx.state.env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, enabled, threshold, params, updated_at FROM bg_withdraw_review_config`,
  )
  ok(ctx, {
    config: rows.map((r) => {
      const code = String(r.rule_code)
      return {
        ruleCode: code, name: RULE_META[code]?.name ?? code, desc: RULE_META[code]?.desc ?? '',
        enabled: Boolean(r.enabled),
        threshold: r.threshold == null ? null : Number(r.threshold),
        params: r.params == null ? null : (typeof r.params === 'string' ? JSON.parse(r.params) : r.params),
        updatedAt: r.updated_at ? new Date(r.updated_at as Date).toISOString() : null,
      }
    }),
  })
})

router.put('/config', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅超级管理员可修改审核规则配置'); return }
  if (!isMysqlEnabled(ctx.state.env)) { fail(ctx, 503, 'DB not available'); return }
  const body = ctx.request.body as {
    config?: { ruleCode: string; enabled: boolean; threshold?: number | null; params?: Record<string, unknown> | null }[]
  }
  if (!Array.isArray(body.config) || body.config.length === 0) { fail(ctx, 400, 'config array required'); return }
  const pool = getMysqlPool(ctx.state.env)
  for (const item of body.config) {
    if (!item.ruleCode || !(item.ruleCode in RULE_META)) { fail(ctx, 400, `unknown ruleCode: ${item.ruleCode}`); return }
    await pool.execute(
      `UPDATE bg_withdraw_review_config SET enabled = ?, threshold = ?, params = ? WHERE rule_code = ?`,
      [item.enabled ? 1 : 0, item.threshold ?? null, item.params == null ? null : JSON.stringify(item.params), item.ruleCode],
    )
  }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'review.config.update', targetType: 'review_config',
    detail: { rules: body.config.map((c) => c.ruleCode) }, ip: ctx.ip,
  })
  ok(ctx, { saved: body.config.length })
})

// ── 风控名单 ──────────────────────────────────────────────────────────────────
router.get('/blacklist', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [] }); return }
  const pool = getMysqlPool(ctx.state.env)
  const type = ctx.query.type ? String(ctx.query.type) : undefined
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, type, value, reason, created_by, created_at FROM bg_risk_blacklist
     ${type ? 'WHERE type = ?' : ''} ORDER BY created_at DESC LIMIT 500`,
    type ? [type] : [],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      id: Number(r.id), type: String(r.type), value: String(r.value),
      reason: r.reason ? String(r.reason) : null,
      createdBy: r.created_by ? String(r.created_by) : null,
      createdAt: new Date(r.created_at as Date).toISOString(),
    })),
  })
})

router.post('/blacklist', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅超级管理员可管理风控名单'); return }
  if (!isMysqlEnabled(ctx.state.env)) { fail(ctx, 503, 'DB not available'); return }
  const body = ctx.request.body as { type?: string; value?: string; reason?: string }
  if (!body.type || !['ip', 'device', 'region', 'user'].includes(body.type) || !body.value) {
    fail(ctx, 400, 'type(ip|device|region|user) 和 value 必填'); return
  }
  const pool = getMysqlPool(ctx.state.env)
  await pool.execute(
    `INSERT INTO bg_risk_blacklist (type, value, reason, created_by) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
    [body.type, body.value, body.reason ?? null, ctx.state.adminUsername ?? null],
  )
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'review.blacklist.add', targetType: 'blacklist', targetId: `${body.type}:${body.value}`,
    detail: { reason: body.reason }, ip: ctx.ip,
  })
  ok(ctx, { added: true })
})

router.delete('/blacklist/:id', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅超级管理员可管理风控名单'); return }
  if (!isMysqlEnabled(ctx.state.env)) { fail(ctx, 503, 'DB not available'); return }
  const pool = getMysqlPool(ctx.state.env)
  await pool.execute(`DELETE FROM bg_risk_blacklist WHERE id = ?`, [Number(ctx.params.id)])
  ok(ctx, { deleted: Number(ctx.params.id) })
})

export default router
