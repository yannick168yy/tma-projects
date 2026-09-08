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
            p.external_username AS player_id
     FROM bg_wxgame_player_rtp r
     LEFT JOIN bg_aggregator_player p ON p.aggregator_id = 'wxgame' AND p.user_id = r.user_id
     ${where} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`,
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

export default router
