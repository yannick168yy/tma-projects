import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { ok, fail } from '../../utils/response.js'
import { normalizeDomain, settleAgentMonth } from '../../services/agent.service.js'

const router = new Router({ prefix: '/agent' })

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// GET /admin/agent/list?search=&page=&pageSize=
router.get('/list', async (ctx) => {
  const search = ctx.query.search ? String(ctx.query.search) : ''
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset = (page - 1) * pageSize
  const db = getMysqlPool(ctx.state.env)
  const period = currentPeriod()

  const where = search ? `AND (a.agent_id LIKE ? OR a.name LIKE ? OR u.display_name LIKE ?)` : ''
  const sParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_agent a JOIN bg_user u ON u.id = a.agent_id WHERE 1=1 ${where}`,
    sParams,
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT a.agent_id, a.name, a.ggr_rate_pct, a.status, a.created_at,
            u.display_name,
            (SELECT COUNT(*) FROM bg_user_agent ua WHERE ua.agent_id = a.agent_id) AS user_count,
            (SELECT COUNT(*) FROM bg_agent_channel c WHERE c.agent_id = a.agent_id) AS channel_count,
            COALESCE((SELECT commission_cents FROM bg_agent_commission ac
                      WHERE ac.agent_id = a.agent_id AND ac.period = ?), 0) AS this_month_commission_cents
     FROM bg_agent a JOIN bg_user u ON u.id = a.agent_id
     WHERE 1=1 ${where}
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [period, ...sParams, pageSize, offset],
  )

  ok(ctx, { total: Number(total), page, pageSize, items: rows })
})

// POST /admin/agent  设为代理 { userId, name?, ggrRatePct, remark? }
router.post('/', async (ctx) => {
  const body = ctx.request.body as { userId?: string; name?: string; ggrRatePct?: number; remark?: string }
  if (!body.userId) { fail(ctx, 400, 'userId is required'); return }
  const rate = Number(body.ggrRatePct ?? 0)
  if (!(rate >= 0 && rate <= 100)) { fail(ctx, 400, 'ggrRatePct 须在 0-100 之间'); return }
  const db = getMysqlPool(ctx.state.env)

  const [[user]] = await db.query<RowDataPacket[]>(`SELECT id, display_name FROM bg_user WHERE id = ?`, [body.userId])
  if (!user) { fail(ctx, 404, '用户不存在'); return }

  await db.execute(
    `INSERT INTO bg_agent (agent_id, name, ggr_rate_pct, remark, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), ggr_rate_pct = VALUES(ggr_rate_pct),
       remark = VALUES(remark), status = 'active'`,
    [body.userId, body.name || user.display_name || '', rate, body.remark || '', ctx.state.adminId ?? null],
  )
  ok(ctx, { agentId: body.userId })
})

// PATCH /admin/agent/:agentId  { name?, ggrRatePct?, status?, remark? }
router.patch('/:agentId', async (ctx) => {
  const { agentId } = ctx.params
  const body = ctx.request.body as { name?: string; ggrRatePct?: number; status?: string; remark?: string }
  const db = getMysqlPool(ctx.state.env)
  const sets: string[] = []
  const params: (string | number)[] = []
  if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name) }
  if (body.ggrRatePct !== undefined) {
    const rate = Number(body.ggrRatePct)
    if (!(rate >= 0 && rate <= 100)) { fail(ctx, 400, 'ggrRatePct 须在 0-100 之间'); return }
    sets.push('ggr_rate_pct = ?'); params.push(rate)
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'disabled') { fail(ctx, 400, 'status 非法'); return }
    sets.push('status = ?'); params.push(body.status)
  }
  if (body.remark !== undefined) { sets.push('remark = ?'); params.push(body.remark) }
  if (!sets.length) { fail(ctx, 400, '无更新字段'); return }
  params.push(agentId)
  await db.execute(`UPDATE bg_agent SET ${sets.join(', ')} WHERE agent_id = ?`, params)
  ok(ctx, { agentId })
})

// GET /admin/agent/:agentId  详情：基本信息 + 渠道
router.get('/:agentId', async (ctx) => {
  const { agentId } = ctx.params
  const db = getMysqlPool(ctx.state.env)
  const [[agent]] = await db.query<RowDataPacket[]>(
    `SELECT a.agent_id, a.name, a.ggr_rate_pct, a.status, a.remark, a.created_at,
            u.display_name,
            (SELECT COUNT(*) FROM bg_user_agent ua WHERE ua.agent_id = a.agent_id) AS user_count
     FROM bg_agent a JOIN bg_user u ON u.id = a.agent_id WHERE a.agent_id = ?`,
    [agentId],
  )
  if (!agent) { fail(ctx, 404, '代理不存在'); return }
  const [channels] = await db.query<RowDataPacket[]>(
    `SELECT id, channel_type, channel_value, enabled, created_at FROM bg_agent_channel
     WHERE agent_id = ? ORDER BY created_at DESC`,
    [agentId],
  )
  ok(ctx, { agent, channels })
})

// GET /admin/agent/:agentId/users?page=&pageSize=
router.get('/:agentId/users', async (ctx) => {
  const { agentId } = ctx.params
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset = (page - 1) * pageSize
  const db = getMysqlPool(ctx.state.env)
  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_user_agent WHERE agent_id = ?`, [agentId],
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ua.user_id, ua.source, ua.bound_at, u.display_name, u.registered_at
     FROM bg_user_agent ua JOIN bg_user u ON u.id = ua.user_id
     WHERE ua.agent_id = ? ORDER BY ua.bound_at DESC LIMIT ? OFFSET ?`,
    [agentId, pageSize, offset],
  )
  ok(ctx, { total: Number(total), page, pageSize, items: rows })
})

// GET /admin/agent/:agentId/commissions
router.get('/:agentId/commissions', async (ctx) => {
  const { agentId } = ctx.params
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT period, ggr_cents, carry_in_cents, net_ggr_cents, carry_out_cents,
            rate_pct, commission_cents, status, paid_at, settled_at
     FROM bg_agent_commission WHERE agent_id = ? ORDER BY period DESC LIMIT 36`,
    [agentId],
  )
  ok(ctx, { items: rows })
})

// POST /admin/agent/:agentId/channel  { channelType, channelValue }
router.post('/:agentId/channel', async (ctx) => {
  const { agentId } = ctx.params
  const body = ctx.request.body as { channelType?: string; channelValue?: string }
  if (body.channelType !== 'domain' && body.channelType !== 'bot') { fail(ctx, 400, 'channelType 非法'); return }
  const value = body.channelType === 'domain' ? normalizeDomain(body.channelValue) : (body.channelValue || '').trim()
  if (!value) { fail(ctx, 400, 'channelValue 必填'); return }
  const db = getMysqlPool(ctx.state.env)
  try {
    const [r] = await db.execute<ResultSetHeader>(
      `INSERT INTO bg_agent_channel (agent_id, channel_type, channel_value) VALUES (?, ?, ?)`,
      [agentId, body.channelType, value],
    )
    ok(ctx, { id: r.insertId, channelValue: value })
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') { fail(ctx, 409, '该渠道已被占用'); return }
    throw e
  }
})

// PATCH /admin/agent/channel/:id  { enabled }
router.patch('/channel/:id', async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as { enabled?: boolean }
  const db = getMysqlPool(ctx.state.env)
  await db.execute(`UPDATE bg_agent_channel SET enabled = ? WHERE id = ?`, [body.enabled ? 1 : 0, id])
  ok(ctx, { id })
})

// DELETE /admin/agent/channel/:id
router.delete('/channel/:id', async (ctx) => {
  const { id } = ctx.params
  const db = getMysqlPool(ctx.state.env)
  await db.execute(`DELETE FROM bg_agent_channel WHERE id = ?`, [id])
  ok(ctx, { id })
})

// POST /admin/agent/bind-user  手动归因 { userId, agentId }
router.post('/bind-user', async (ctx) => {
  const body = ctx.request.body as { userId?: string; agentId?: string }
  if (!body.userId || !body.agentId) { fail(ctx, 400, 'userId 和 agentId 必填'); return }
  const db = getMysqlPool(ctx.state.env)
  const [[agent]] = await db.query<RowDataPacket[]>(`SELECT agent_id FROM bg_agent WHERE agent_id = ?`, [body.agentId])
  if (!agent) { fail(ctx, 404, '目标代理不存在'); return }
  await db.execute(
    `INSERT INTO bg_user_agent (user_id, agent_id, source, bound_by) VALUES (?, ?, 'manual', ?)
     ON DUPLICATE KEY UPDATE agent_id = VALUES(agent_id), source = 'manual',
       bound_by = VALUES(bound_by), bound_at = CURRENT_TIMESTAMP(3)`,
    [body.userId, body.agentId, ctx.state.adminId ?? null],
  )
  ok(ctx, { userId: body.userId, agentId: body.agentId })
})

// DELETE /admin/agent/user/:userId  解除归因
router.delete('/user/:userId', async (ctx) => {
  const { userId } = ctx.params
  const db = getMysqlPool(ctx.state.env)
  await db.execute(`DELETE FROM bg_user_agent WHERE user_id = ?`, [userId])
  ok(ctx, { userId })
})

// GET /admin/agent/user/:userId/info  某用户的代理身份与归属（UserDetail 用）
router.get('/user/:userId/info', async (ctx) => {
  const { userId } = ctx.params
  const db = getMysqlPool(ctx.state.env)
  const [[agent]] = await db.query<RowDataPacket[]>(
    `SELECT agent_id, name, ggr_rate_pct, status FROM bg_agent WHERE agent_id = ?`, [userId],
  )
  const [[attribution]] = await db.query<RowDataPacket[]>(
    `SELECT ua.agent_id, ua.source, ua.bound_at, a.name AS agent_name
     FROM bg_user_agent ua LEFT JOIN bg_agent a ON a.agent_id = ua.agent_id
     WHERE ua.user_id = ?`,
    [userId],
  )
  ok(ctx, { isAgent: Boolean(agent), agent: agent ?? null, attributedTo: attribution ?? null })
})

// POST /admin/agent/settle  { period? } 触发月度结算（默认上月）
router.post('/settle', async (ctx) => {
  const body = ctx.request.body as { period?: string }
  let period = body.period
  if (!period) {
    const d = new Date()
    d.setDate(0) // 上月最后一天
    period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  if (!/^\d{4}-\d{2}$/.test(period)) { fail(ctx, 400, 'period 格式须为 YYYY-MM'); return }
  const result = await settleAgentMonth(ctx.state.env, period)
  ok(ctx, result)
})

// GET /admin/agent/commissions?period=  分成报表（跨代理）
router.get('/commissions/report', async (ctx) => {
  const period = ctx.query.period ? String(ctx.query.period) : currentPeriod()
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ac.agent_id, a.name, ac.ggr_cents, ac.carry_in_cents, ac.net_ggr_cents,
            ac.carry_out_cents, ac.rate_pct, ac.commission_cents, ac.status, ac.paid_at
     FROM bg_agent_commission ac JOIN bg_agent a ON a.agent_id = ac.agent_id
     WHERE ac.period = ? ORDER BY ac.commission_cents DESC`,
    [period],
  )
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(commission_cents),0) AS total_commission_cents,
            COALESCE(SUM(CASE WHEN status='pending' THEN commission_cents ELSE 0 END),0) AS pending_cents
     FROM bg_agent_commission WHERE period = ?`,
    [period],
  )
  ok(ctx, { period, summary, items: rows })
})

// POST /admin/agent/commission/pay  { agentId, period }  标记线下已打款
router.post('/commission/pay', async (ctx) => {
  const body = ctx.request.body as { agentId?: string; period?: string }
  if (!body.agentId || !body.period) { fail(ctx, 400, 'agentId 和 period 必填'); return }
  const db = getMysqlPool(ctx.state.env)
  await db.execute(
    `UPDATE bg_agent_commission SET status = 'paid', paid_at = CURRENT_TIMESTAMP(3)
     WHERE agent_id = ? AND period = ? AND status = 'pending'`,
    [body.agentId, body.period],
  )
  ok(ctx, { agentId: body.agentId, period: body.period })
})

export default router
