import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { ok, fail } from '../../utils/response.js'
import { normalizeDomain, settleAgentMonth, verifyBotToken } from '../../services/agent.service.js'

const router = new Router({ prefix: '/agent' })

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 当前自然月的 [start, end) 区间，用于按用户聚合当月 GGR
function currentMonthRange(): { start: string; end: string } {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const start = `${y}-${String(m).padStart(2, '0')}-01 00:00:00`
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const end = `${ny}-${String(nm).padStart(2, '0')}-01 00:00:00`
  return { start, end }
}

async function agentExists(db: ReturnType<typeof getMysqlPool>, agentId: string): Promise<boolean> {
  const [[row]] = await db.query<RowDataPacket[]>(`SELECT 1 FROM bg_agent WHERE agent_id = ? LIMIT 1`, [agentId])
  return Boolean(row)
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
            ((SELECT COUNT(*) FROM bg_agent_domain d WHERE d.agent_id = a.agent_id)
             + (SELECT COUNT(*) FROM bg_agent_bot b WHERE b.agent_id = a.agent_id)) AS channel_count,
            COALESCE((SELECT commission_cents FROM bg_agent_commission ac
                      WHERE ac.agent_id = a.agent_id AND ac.period = ?), 0) AS this_month_commission_cents
     FROM bg_agent a JOIN bg_user u ON u.id = a.agent_id
     WHERE 1=1 ${where}
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [period, ...sParams, pageSize, offset],
  )

  ok(ctx, { total: Number(total), page, pageSize, items: rows })
})

// ── 域名管理 ─────────────────────────────────────────────────────────────────
// GET /admin/agent/domains?onlyUnassigned=1
router.get('/domains', async (ctx) => {
  const onlyUnassigned = ctx.query.onlyUnassigned === '1'
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT d.id, d.domain, d.label, d.enabled, d.agent_id, a.name AS agent_name, d.created_at
     FROM bg_agent_domain d LEFT JOIN bg_agent a ON a.agent_id = d.agent_id
     ${onlyUnassigned ? 'WHERE d.agent_id IS NULL' : ''}
     ORDER BY d.created_at DESC`,
  )
  ok(ctx, { items: rows })
})

// POST /admin/agent/domains  { domain, label?, agentId? }
router.post('/domains', async (ctx) => {
  const body = ctx.request.body as { domain?: string; label?: string; agentId?: string }
  const domain = normalizeDomain(body.domain)
  if (!domain) { fail(ctx, 400, 'domain 必填'); return }
  const db = getMysqlPool(ctx.state.env)
  try {
    const [r] = await db.execute<ResultSetHeader>(
      `INSERT INTO bg_agent_domain (domain, label, agent_id, created_by) VALUES (?, ?, ?, ?)`,
      [domain, body.label || '', body.agentId || null, ctx.state.adminId ?? null],
    )
    ok(ctx, { id: r.insertId, domain })
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') { fail(ctx, 409, '该域名已存在'); return }
    throw e
  }
})

// PATCH /admin/agent/domains/:id  { label?, enabled?, agentId?(null=解绑) }
router.patch('/domains/:id', async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as { label?: string; enabled?: boolean; agentId?: string | null }
  const db = getMysqlPool(ctx.state.env)
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (body.label !== undefined) { sets.push('label = ?'); params.push(body.label) }
  if (body.enabled !== undefined) { sets.push('enabled = ?'); params.push(body.enabled ? 1 : 0) }
  if ('agentId' in body) {
    if (body.agentId && !(await agentExists(db, body.agentId))) { fail(ctx, 400, '目标代理不存在，请先在「代理管理」中设为代理'); return }
    sets.push('agent_id = ?'); params.push(body.agentId ?? null)
  }
  if (!sets.length) { fail(ctx, 400, '无更新字段'); return }
  params.push(id)
  await db.execute(`UPDATE bg_agent_domain SET ${sets.join(', ')} WHERE id = ?`, params)
  ok(ctx, { id })
})

// DELETE /admin/agent/domains/:id
router.delete('/domains/:id', async (ctx) => {
  const { id } = ctx.params
  const db = getMysqlPool(ctx.state.env)
  await db.execute(`DELETE FROM bg_agent_domain WHERE id = ?`, [id])
  ok(ctx, { id })
})

// ── 机器人管理 ───────────────────────────────────────────────────────────────
// GET /admin/agent/bots?onlyUnassigned=1   （不回传 bot_token）
router.get('/bots', async (ctx) => {
  const onlyUnassigned = ctx.query.onlyUnassigned === '1'
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT b.id, b.bot_username, b.bot_id, b.label, b.enabled, b.agent_id, a.name AS agent_name, b.created_at
     FROM bg_agent_bot b LEFT JOIN bg_agent a ON a.agent_id = b.agent_id
     ${onlyUnassigned ? 'WHERE b.agent_id IS NULL' : ''}
     ORDER BY b.created_at DESC`,
  )
  ok(ctx, { items: rows })
})

// POST /admin/agent/bots  { botToken, label?, agentId? } — 调 getMe 校验并取 bot_id/username
router.post('/bots', async (ctx) => {
  const body = ctx.request.body as { botToken?: string; label?: string; agentId?: string }
  const token = (body.botToken || '').trim()
  if (!token) { fail(ctx, 400, 'botToken 必填'); return }
  let info: { botId: number; username: string }
  try {
    info = await verifyBotToken(token)
  } catch {
    fail(ctx, 400, 'bot token 无效，getMe 校验失败'); return
  }
  if (!info.username) { fail(ctx, 400, '该 bot 未设置 username'); return }
  const db = getMysqlPool(ctx.state.env)
  try {
    const [r] = await db.execute<ResultSetHeader>(
      `INSERT INTO bg_agent_bot (bot_username, bot_id, bot_token, label, agent_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [info.username, info.botId, token, body.label || '', body.agentId || null, ctx.state.adminId ?? null],
    )
    ok(ctx, { id: r.insertId, botUsername: info.username, botId: info.botId })
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') { fail(ctx, 409, '该机器人已存在'); return }
    throw e
  }
})

// PATCH /admin/agent/bots/:id  { label?, enabled?, agentId?(null=解绑) }
router.patch('/bots/:id', async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as { label?: string; enabled?: boolean; agentId?: string | null }
  const db = getMysqlPool(ctx.state.env)
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (body.label !== undefined) { sets.push('label = ?'); params.push(body.label) }
  if (body.enabled !== undefined) { sets.push('enabled = ?'); params.push(body.enabled ? 1 : 0) }
  if ('agentId' in body) {
    if (body.agentId && !(await agentExists(db, body.agentId))) { fail(ctx, 400, '目标代理不存在，请先在「代理管理」中设为代理'); return }
    sets.push('agent_id = ?'); params.push(body.agentId ?? null)
  }
  if (!sets.length) { fail(ctx, 400, '无更新字段'); return }
  params.push(id)
  await db.execute(`UPDATE bg_agent_bot SET ${sets.join(', ')} WHERE id = ?`, params)
  ok(ctx, { id })
})

// DELETE /admin/agent/bots/:id
router.delete('/bots/:id', async (ctx) => {
  const { id } = ctx.params
  const db = getMysqlPool(ctx.state.env)
  await db.execute(`DELETE FROM bg_agent_bot WHERE id = ?`, [id])
  ok(ctx, { id })
})

// POST /admin/agent  设为代理 { userId, name?, ggrRatePct, remark?, domainIds?, botIds? }
router.post('/', async (ctx) => {
  const body = ctx.request.body as {
    userId?: string; name?: string; ggrRatePct?: number; remark?: string
    domainIds?: number[]; botIds?: number[]
  }
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

  // 分配选中的域名/机器人（仅分配未被占用的）
  const domainIds = (body.domainIds ?? []).filter((n) => Number.isInteger(n))
  const botIds = (body.botIds ?? []).filter((n) => Number.isInteger(n))
  if (domainIds.length) {
    await db.query(`UPDATE bg_agent_domain SET agent_id = ? WHERE id IN (?) AND agent_id IS NULL`, [body.userId, domainIds])
  }
  if (botIds.length) {
    await db.query(`UPDATE bg_agent_bot SET agent_id = ? WHERE id IN (?) AND agent_id IS NULL`, [body.userId, botIds])
  }
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
  const [domains] = await db.query<RowDataPacket[]>(
    `SELECT id, domain, label, enabled, created_at FROM bg_agent_domain
     WHERE agent_id = ? ORDER BY created_at DESC`,
    [agentId],
  )
  const [bots] = await db.query<RowDataPacket[]>(
    `SELECT id, bot_username, bot_id, label, enabled, created_at FROM bg_agent_bot
     WHERE agent_id = ? ORDER BY created_at DESC`,
    [agentId],
  )
  ok(ctx, { agent, domains, bots })
})

// GET /admin/agent/:agentId/users?page=&pageSize=
router.get('/:agentId/users', async (ctx) => {
  const { agentId } = ctx.params
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset = (page - 1) * pageSize
  const db = getMysqlPool(ctx.state.env)
  const { start, end } = currentMonthRange()
  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_user_agent WHERE agent_id = ?`, [agentId],
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ua.user_id, ua.source, ua.bound_at, u.display_name, u.registered_at,
            CAST(ROUND((
              (SELECT COALESCE(SUM(CASE WHEN bo.bet_type = 'bet' THEN bo.amount
                                        WHEN bo.bet_type = 'win' THEN -bo.amount ELSE 0 END), 0)
               FROM bg_bet_order bo
               WHERE bo.user_id = ua.user_id AND bo.status = 'settled' AND bo.created_at >= ? AND bo.created_at < ?)
              - (SELECT COALESCE(SUM(l.amount), 0) FROM bg_wallet_ledger l
                 WHERE l.user_id = ua.user_id AND l.type IN ('bonus', 'red_packet')
                   AND l.created_at >= ? AND l.created_at < ?)
            ) * 100) AS SIGNED) AS ggr_cents
     FROM bg_user_agent ua JOIN bg_user u ON u.id = ua.user_id
     WHERE ua.agent_id = ? ORDER BY ua.bound_at DESC LIMIT ? OFFSET ?`,
    [start, end, start, end, agentId, pageSize, offset],
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

// PATCH /admin/agent/:agentId/assign-domain  { domainId }  分配域名给代理
router.patch('/:agentId/assign-domain', async (ctx) => {
  const { agentId } = ctx.params
  const body = ctx.request.body as { domainId?: number }
  if (!body.domainId) { fail(ctx, 400, 'domainId 必填'); return }
  const db = getMysqlPool(ctx.state.env)
  await db.execute(`UPDATE bg_agent_domain SET agent_id = ? WHERE id = ?`, [agentId, body.domainId])
  ok(ctx, { domainId: body.domainId, agentId })
})

// PATCH /admin/agent/:agentId/assign-bot  { botId }  分配机器人给代理
router.patch('/:agentId/assign-bot', async (ctx) => {
  const { agentId } = ctx.params
  const body = ctx.request.body as { botId?: number }
  if (!body.botId) { fail(ctx, 400, 'botId 必填'); return }
  const db = getMysqlPool(ctx.state.env)
  await db.execute(`UPDATE bg_agent_bot SET agent_id = ? WHERE id = ?`, [agentId, body.botId])
  ok(ctx, { botId: body.botId, agentId })
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
