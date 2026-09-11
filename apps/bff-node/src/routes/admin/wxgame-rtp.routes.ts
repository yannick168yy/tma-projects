import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { getOpPasswordHash, writeAuditLog } from '../../services/admin-store.js'
import { verifyPassword } from '../../services/admin-auth.service.js'
import { requireRole } from '../../middleware/require-role.js'
import type { RowDataPacket } from 'mysql2/promise'

const router = new Router({ prefix: '/wxgame-rtp' })

async function core(ctx: import('koa').Context, path: string, body: unknown) {
  const res = await fetch(`${ctx.state.env.CORE_NODE_URL}/internal/wxgame${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN },
    body: JSON.stringify(body),
  })
  return { okStatus: res.ok, payload: await res.json() as Record<string, unknown> }
}

// 改点控档位直接影响玩家赢面，是资损敏感操作：限 super_admin + 操作密码 + 审计，
// 与余额调整同一套门槛。
const guard = requireRole('super_admin', 'Only super_admin can change player RTP')

async function checkOpPassword(ctx: import('koa').Context, opPassword?: string): Promise<boolean> {
  if (!opPassword) { fail(ctx, 400, 'opPassword is required'); return false }
  const hash = await getOpPasswordHash(ctx.state.env)
  if (!hash) { fail(ctx, 403, 'Operation password not configured. Please ask super_admin to set it first.'); return false }
  if (!await verifyPassword(opPassword, hash)) { fail(ctx, 403, 'Incorrect operation password'); return false }
  return true
}

router.get('/tiers', async (ctx) => {
  const res = await fetch(`${ctx.state.env.CORE_NODE_URL}/internal/wxgame/rtp/tiers`, {
    headers: { 'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN },
  })
  ok(ctx, await res.json())
})

// 本地记录 + 是否已被上游确认。synced_at 为空表示上游没确认成功，后台要显式标出来，
// 否则运营会以为已生效。
router.get('/', async (ctx) => {
  const q = ctx.query as { userId?: string; page?: string; pageSize?: string }
  const pageSize = Math.min(Number(q.pageSize) || 20, 100)
  const offset = (Math.max(Number(q.page) || 1, 1) - 1) * pageSize
  const pool = getMysqlPool(ctx.state.env)
  const where = q.userId ? 'WHERE r.user_id = ?' : ''
  const params = q.userId ? [q.userId] : []
  const [[{ total }]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_wxgame_player_rtp r ${where}`, params,
  )
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.user_id, r.rtp, r.operator_id, r.reason, r.synced_at, r.updated_at,
            GROUP_CONCAT(p.external_username ORDER BY p.currency SEPARATOR ', ') AS player_id
     FROM bg_wxgame_player_rtp r
     LEFT JOIN bg_aggregator_player p ON p.aggregator_id = 'wxgame' AND p.user_id = r.user_id
     ${where} GROUP BY r.user_id, r.rtp, r.operator_id, r.reason, r.synced_at, r.updated_at
     ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  ok(ctx, {
    total: Number(total),
    items: rows.map((r) => ({
      userId: String(r.user_id),
      playerId: r.player_id ? String(r.player_id) : null,
      rtp: String(r.rtp),
      operatorId: r.operator_id ? String(r.operator_id) : null,
      reason: r.reason ? String(r.reason) : null,
      synced: r.synced_at != null,
      updatedAt: r.updated_at ? new Date(r.updated_at as Date).toISOString() : null,
    })),
  })
})

router.post('/set', guard, async (ctx) => {
  const body = ctx.request.body as { userIds?: string[]; rtp?: string; reason?: string; opPassword?: string }
  if (!Array.isArray(body.userIds) || body.userIds.length === 0) { fail(ctx, 400, 'userIds is required'); return }
  if (!body.rtp) { fail(ctx, 400, 'rtp is required'); return }
  if (!await checkOpPassword(ctx, body.opPassword)) return

  const { okStatus, payload } = await core(ctx, '/rtp/set', {
    userIds: body.userIds, rtp: body.rtp,
    operatorId: String(ctx.state.adminUsername ?? ctx.state.adminId ?? ''),
    reason: body.reason,
  })
  if (!okStatus) { fail(ctx, 400, String(payload.error ?? 'failed to set rtp')); return }

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'wxgame_rtp_set', targetType: 'user', targetId: body.userIds.join(','),
    detail: { rtp: body.rtp, reason: body.reason, ...payload }, ip: ctx.ip,
  })
  ok(ctx, payload)
})

router.post('/unset', guard, async (ctx) => {
  const body = ctx.request.body as { userIds?: string[]; opPassword?: string }
  if (!Array.isArray(body.userIds) || body.userIds.length === 0) { fail(ctx, 400, 'userIds is required'); return }
  if (!await checkOpPassword(ctx, body.opPassword)) return

  const { okStatus, payload } = await core(ctx, '/rtp/unset', { userIds: body.userIds })
  if (!okStatus) { fail(ctx, 400, String(payload.error ?? 'failed to unset rtp')); return }

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'wxgame_rtp_unset', targetType: 'user', targetId: body.userIds.join(','),
    detail: payload, ip: ctx.ip,
  })
  ok(ctx, payload)
})

// 与上游核对：本地记录可能因为设置失败而与上游不一致
router.post('/verify', guard, async (ctx) => {
  const body = ctx.request.body as { userIds?: string[] }
  if (!Array.isArray(body.userIds) || body.userIds.length === 0) { fail(ctx, 400, 'userIds is required'); return }
  const { okStatus, payload } = await core(ctx, '/rtp/query', { userIds: body.userIds })
  if (!okStatus) { fail(ctx, 502, String(payload.error ?? 'query failed')); return }
  ok(ctx, payload)
})

// ── 对账差异 ────────────────────────────────────────────────
// 只读 + 标记已处理，不提供"自动补账"：金额对不上时以谁为准要人判断，
// 自动补在对账逻辑本身有 bug 时会放大损失。

router.get('/recon/diffs', async (ctx) => {
  const q = ctx.query as { resolved?: string; type?: string; page?: string; pageSize?: string }
  const pageSize = Math.min(Number(q.pageSize) || 20, 100)
  const offset = (Math.max(Number(q.page) || 1, 1) - 1) * pageSize
  const where: string[] = []
  const params: unknown[] = []
  where.push(q.resolved === '1' ? 'resolved_at IS NOT NULL' : 'resolved_at IS NULL')
  if (q.type) { where.push('diff_type = ?'); params.push(q.type) }
  const clause = `WHERE ${where.join(' AND ')}`

  const pool = getMysqlPool(ctx.state.env)
  const [[{ total }]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_wxgame_recon_diff ${clause}`, params,
  )
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, round_id, transaction_id, player_id, user_id, diff_type,
            upstream_bet, upstream_win, upstream_status, local_bet, local_win,
            resolved_at, resolved_note, created_at
     FROM bg_wxgame_recon_diff ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[cursor]] = await pool.query<RowDataPacket[]>(
    `SELECT last_run_at, last_scanned, last_error FROM bg_wxgame_recon_cursor WHERE id = 1`,
  )
  ok(ctx, {
    total: Number(total),
    lastRunAt: cursor?.last_run_at ? new Date(cursor.last_run_at as Date).toISOString() : null,
    lastScanned: cursor?.last_scanned == null ? null : Number(cursor.last_scanned),
    lastError: cursor?.last_error ? String(cursor.last_error) : null,
    items: rows.map((r) => ({
      id: Number(r.id),
      roundId: String(r.round_id),
      transactionId: r.transaction_id ? String(r.transaction_id) : null,
      playerId: r.player_id ? String(r.player_id) : null,
      userId: r.user_id ? String(r.user_id) : null,
      diffType: String(r.diff_type),
      upstream: { bet: r.upstream_bet == null ? null : Number(r.upstream_bet), win: r.upstream_win == null ? null : Number(r.upstream_win), status: r.upstream_status ? String(r.upstream_status) : null },
      local: { bet: r.local_bet == null ? null : Number(r.local_bet), win: r.local_win == null ? null : Number(r.local_win) },
      resolvedAt: r.resolved_at ? new Date(r.resolved_at as Date).toISOString() : null,
      resolvedNote: r.resolved_note ? String(r.resolved_note) : null,
      createdAt: r.created_at ? new Date(r.created_at as Date).toISOString() : null,
    })),
  })
})

router.post('/recon/diffs/:id/resolve', guard, async (ctx) => {
  const body = ctx.request.body as { note?: string }
  if (!body.note) { fail(ctx, 400, 'note is required'); return }
  const pool = getMysqlPool(ctx.state.env)
  const [res] = await pool.execute(
    `UPDATE bg_wxgame_recon_diff SET resolved_at = NOW(3), resolved_note = ?
     WHERE id = ? AND resolved_at IS NULL`,
    [body.note, ctx.params.id],
  )
  const affected = (res as { affectedRows: number }).affectedRows
  if (affected === 0) { fail(ctx, 404, 'diff not found or already resolved'); return }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'wxgame_recon_resolve', targetType: 'recon_diff', targetId: String(ctx.params.id),
    detail: { note: body.note }, ip: ctx.ip,
  })
  ok(ctx, { resolved: true })
})

export default router
