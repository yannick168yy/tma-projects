import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { ok, fail } from '../../utils/response.js'
import { fetchMonthTurnoverBreakdown, sumBreakdownCents } from '../../utils/team-turnover.js'

const router = new Router({ prefix: '/team' })

// GET /admin/team/overview
router.get('/overview', async (ctx) => {
  const db = getMysqlPool(ctx.state.env)
  const today = currentDate()

  const [[agents], [commission], [pending]] = await Promise.all([
    db.query<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM bg_team_node WHERE opted_in = 1`),
    db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(php_equivalent_cents), 0) AS total
       FROM bg_team_commission WHERE period LIKE ? AND status = 'paid'`,
      [currentMonthPrefix()],
    ),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_cents), 0) AS total
       FROM bg_team_withdrawal WHERE status = 'pending' AND review_verdict = 'manual'`,
    ),
  ])

  ok(ctx, {
    activeAgents:             Number(agents[0]?.cnt ?? 0),
    thisMonthCommissionCents: Number(commission[0]?.total ?? 0),
    pendingWithdrawalCount:   Number(pending[0]?.cnt ?? 0),
    pendingWithdrawalCents:   Number(pending[0]?.total ?? 0),
    today,
  })
})

// GET /admin/team/agents?search=&page=1&pageSize=20
router.get('/agents', async (ctx) => {
  const search   = ctx.query.search ? String(ctx.query.search) : ''
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset   = (page - 1) * pageSize
  const db       = getMysqlPool(ctx.state.env)

  const where  = search ? `AND (u.id LIKE ? OR u.display_name LIKE ?)` : ''
  const params: unknown[] = search ? [`%${search}%`, `%${search}%`] : []

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_team_node tn
     JOIN bg_user u ON u.id = tn.user_id
     WHERE tn.opted_in = 1 ${where}`,
    params,
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.opted_in_at, tn.rate_plan_id,
            rp.name AS rate_plan_name,
            u.display_name,
            (SELECT COUNT(*) FROM bg_team_node WHERE l1_referrer_id = tn.user_id) AS l1_count,
            (SELECT COUNT(*) FROM bg_team_node WHERE l2_referrer_id = tn.user_id) AS l2_count,
            (SELECT COUNT(*) FROM bg_team_node WHERE l3_referrer_id = tn.user_id) AS l3_count,
            COALESCE((SELECT SUM(php_equivalent_cents) FROM bg_team_commission
                      WHERE beneficiary_id = tn.user_id AND period LIKE ?), 0) AS this_month_cents,
            COALESCE(tw.lifetime_earned_cents, 0) AS lifetime_cents
     FROM bg_team_node tn
     JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN bg_team_rate_plan rp ON rp.id = tn.rate_plan_id
     LEFT JOIN bg_team_wallet tw ON tw.user_id = tn.user_id
     WHERE tn.opted_in = 1 ${where}
     ORDER BY lifetime_cents DESC
     LIMIT ? OFFSET ?`,
    [currentMonthPrefix(), ...params, pageSize, offset],
  )

  ok(ctx, {
    total: Number(total), page, pageSize,
    items: rows.map(r => ({
      userId:                   r.user_id,
      displayName:              r.display_name,
      ratePlanId:               r.rate_plan_id ?? null,
      ratePlanName:             r.rate_plan_name ?? null,
      l1Count:                  Number(r.l1_count),
      l2Count:                  Number(r.l2_count),
      l3Count:                  Number(r.l3_count),
      thisMonthCommissionCents: Number(r.this_month_cents),
      lifetimeEarnedCents:      Number(r.lifetime_cents),
      optedInAt:                r.opted_in_at,
    })),
  })
})

// GET /admin/team/agents/:userId
router.get('/agents/:userId', async (ctx) => {
  const { userId } = ctx.params
  const db = getMysqlPool(ctx.state.env)

  const [[node], [wallet], periods] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT tn.*, u.display_name, rp.name AS rate_plan_name,
              rp.l1_rate_pct, rp.l2_rate_pct, rp.l3_rate_pct
       FROM bg_team_node tn
       JOIN bg_user u ON u.id = tn.user_id
       LEFT JOIN bg_team_rate_plan rp ON rp.id = tn.rate_plan_id
       WHERE tn.user_id = ? LIMIT 1`,
      [userId],
    ),
    db.query<RowDataPacket[]>(
      `SELECT available_cents, frozen_cents, lifetime_earned_cents FROM bg_team_wallet WHERE user_id = ?`,
      [userId],
    ),
    db.query<RowDataPacket[]>(
      `SELECT LEFT(period, 7) AS month, SUM(commission_cents) AS total, status
       FROM bg_team_commission WHERE beneficiary_id = ?
       GROUP BY month, status ORDER BY month DESC LIMIT 24`,
      [userId],
    ),
  ])

  if (!node.length) { fail(ctx, 404, 'agent not found'); return }
  ok(ctx, { agent: { ...node[0], wallet: wallet[0] ?? null }, history: periods[0] })
})

// GET /admin/team/agents/:userId/tree?date=YYYY-MM-DD (默认当月)
router.get('/agents/:userId/tree', async (ctx) => {
  const { userId } = ctx.params
  const monthPrefix = ctx.query.date
    ? String(ctx.query.date).slice(0, 7)
    : currentMonthPrefix().replace('%', '')
  const db = getMysqlPool(ctx.state.env)

  function turnoverSub(levelCol: string) {
    return `
      SELECT td.user_id, SUM(td.bet_cents) AS turnover_cents
      FROM bg_team_turnover_daily td
      JOIN bg_team_node tm ON tm.user_id = td.user_id AND tm.${levelCol} = ?
      WHERE td.date LIKE ?
      GROUP BY td.user_id`
  }
  function commSub(level: number) {
    return `
      SELECT from_user_id, SUM(php_equivalent_cents) AS commission_cents
      FROM bg_team_commission
      WHERE period LIKE ? AND beneficiary_id = ? AND level = ${level}
      GROUP BY from_user_id`
  }

  const likeParam = `${monthPrefix}%`

  const [l1Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.opted_in, tn.activated, u.display_name,
            COALESCE(t.turnover_cents, 0) AS turnover_cents,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${turnoverSub('l1_referrer_id')}) t ON t.user_id = tn.user_id
     LEFT JOIN (${commSub(1)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l1_referrer_id = ? ORDER BY turnover_cents DESC`,
    [userId, likeParam, likeParam, userId, userId],
  )
  const [l2Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.opted_in, tn.activated, u.display_name,
            COALESCE(t.turnover_cents, 0) AS turnover_cents,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${turnoverSub('l2_referrer_id')}) t ON t.user_id = tn.user_id
     LEFT JOIN (${commSub(2)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l2_referrer_id = ? ORDER BY turnover_cents DESC`,
    [userId, likeParam, likeParam, userId, userId],
  )
  const [l3Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.opted_in, tn.activated, u.display_name,
            COALESCE(t.turnover_cents, 0) AS turnover_cents,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${turnoverSub('l3_referrer_id')}) t ON t.user_id = tn.user_id
     LEFT JOIN (${commSub(3)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l3_referrer_id = ? ORDER BY turnover_cents DESC`,
    [userId, likeParam, likeParam, userId, userId],
  )

  interface NodeData {
    userId: string; displayName: string; isAgent: boolean
    thisMonthCents: number; turnoverCents: number
    currencyBreakdown: { currency: string; betCents: number }[]
    children: NodeData[]
  }

  function toCommCents(raw: unknown): number {
    if (raw !== null && raw !== undefined) return Number(raw)
    return 0
  }

  const allDownlineIds = [
    ...l1Rows.map(r => String(r.user_id)),
    ...l2Rows.map(r => String(r.user_id)),
    ...l3Rows.map(r => String(r.user_id)),
  ]
  const bkMap = await fetchMonthTurnoverBreakdown(db, allDownlineIds, monthPrefix)

  function buildNode(r: RowDataPacket): NodeData {
    const uid = String(r.user_id)
    const breakdown = bkMap.get(uid) ?? []
    return {
      userId: uid, displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in),
      thisMonthCents: toCommCents(r.commission_cents),
      turnoverCents: sumBreakdownCents(breakdown),
      currencyBreakdown: breakdown,
      children: [],
    }
  }

  const l1Map = new Map<string, NodeData>()
  for (const r of l1Rows) l1Map.set(String(r.user_id), buildNode(r))
  const l2Map = new Map<string, NodeData>()
  for (const r of l2Rows) {
    const node = buildNode(r)
    l2Map.set(node.userId, node)
    l1Map.get(String(r.l1_referrer_id))?.children.push(node)
  }
  for (const r of l3Rows) {
    l2Map.get(String(r.l1_referrer_id))?.children.push(buildNode(r))
  }

  ok(ctx, { l1Members: [...l1Map.values()].sort((a, b) => b.turnoverCents - a.turnoverCents) })
})

// GET /admin/team/commissions?date=&month=&beneficiaryId=&status=&page=1
router.get('/commissions', async (ctx) => {
  const dateFilter  = ctx.query.date ? String(ctx.query.date) : ''
  const monthFilter = ctx.query.month ? String(ctx.query.month) : ''
  const beneficiary = ctx.query.beneficiaryId ? String(ctx.query.beneficiaryId) : ''
  const status      = ctx.query.status ? String(ctx.query.status) : ''
  const page        = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize    = 50
  const offset      = (page - 1) * pageSize
  const db          = getMysqlPool(ctx.state.env)

  const conditions: string[] = []
  const params: unknown[]    = []
  if (dateFilter)  { conditions.push('tc.period = ?');           params.push(dateFilter) }
  else if (monthFilter) { conditions.push('tc.period LIKE ?');   params.push(`${monthFilter}%`) }
  if (beneficiary) { conditions.push('tc.beneficiary_id = ?');   params.push(beneficiary) }
  if (status)      { conditions.push('tc.status = ?');           params.push(status) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_team_commission tc ${where}`, params,
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tc.*, b.display_name AS beneficiary_name, f.display_name AS from_name
     FROM bg_team_commission tc
     JOIN bg_user b ON b.id = tc.beneficiary_id
     JOIN bg_user f ON f.id = tc.from_user_id
     ${where}
     ORDER BY tc.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  ok(ctx, { total: Number(total), page, pageSize, items: rows })
})

// POST /admin/team/settle  { date: YYYY-MM-DD, force?: boolean }
router.post('/settle', async (ctx) => {
  const body  = ctx.request.body as { date?: string; force?: boolean }
  const date  = body?.date ?? yesterdayDate()
  const force = Boolean(body?.force ?? false)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(ctx, 400, 'date 格式应为 YYYY-MM-DD'); return
  }

  const res = await fetch(`${ctx.state.env.CORE_NODE_URL}/internal/team/settle`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN },
    body:    JSON.stringify({ date, force }),
  })
  if (!res.ok) { fail(ctx, 502, 'core-node settlement trigger failed'); return }
  ok(ctx, { message: `settlement triggered for ${date}`, force })
})

// GET /admin/team/withdrawals?status=&page=1
router.get('/withdrawals', async (ctx) => {
  const status   = ctx.query.status ? String(ctx.query.status) : ''
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = 20
  const offset   = (page - 1) * pageSize
  const db       = getMysqlPool(ctx.state.env)
  const where    = status ? 'WHERE tw.status = ?' : ''
  const params   = status ? [status] : []

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_team_withdrawal tw ${where}`, params,
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tw.*, u.display_name
     FROM bg_team_withdrawal tw JOIN bg_user u ON u.id = tw.user_id
     ${where}
     ORDER BY tw.status='pending' DESC, tw.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  ok(ctx, { total: Number(total), page, pageSize, items: rows })
})

// POST /admin/team/withdrawals/:id/approve
router.post('/withdrawals/:id/approve', async (ctx) => {
  const id      = Number(ctx.params.id)
  const adminId = (ctx.state as { adminId?: number }).adminId
  const res = await fetch(`${ctx.state.env.CORE_NODE_URL}/internal/team/withdrawal/approve`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN },
    body:    JSON.stringify({ withdrawalId: id }),
  })
  if (!res.ok) { fail(ctx, 502, 'withdrawal approval failed'); return }
  await getMysqlPool(ctx.state.env).execute(
    `UPDATE bg_team_withdrawal SET admin_id = ?, reviewed_at = NOW(3) WHERE id = ?`,
    [adminId ?? null, id],
  )
  ok(ctx, { ok: true })
})

// POST /admin/team/withdrawals/:id/reject  { reason }
router.post('/withdrawals/:id/reject', async (ctx) => {
  const id      = Number(ctx.params.id)
  const body    = ctx.request.body as { reason?: string }
  const reason  = body?.reason ?? ''
  const adminId = (ctx.state as { adminId?: number }).adminId
  const db      = getMysqlPool(ctx.state.env)

  const [[wd]] = await db.query<RowDataPacket[]>(
    `SELECT user_id, amount_cents, status FROM bg_team_withdrawal WHERE id = ? LIMIT 1`, [id],
  )
  if (!wd) { fail(ctx, 404, 'not found'); return }
  if (wd.status !== 'pending') { fail(ctx, 409, 'already processed'); return }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      `UPDATE bg_team_wallet
       SET frozen_cents = frozen_cents - ?, available_cents = available_cents + ?
       WHERE user_id = ?`,
      [wd.amount_cents, wd.amount_cents, wd.user_id],
    )
    await conn.execute(
      `UPDATE bg_team_withdrawal SET status='rejected', reject_reason=?, admin_id=?, reviewed_at=NOW(3) WHERE id=?`,
      [reason, adminId ?? null, id],
    )
    await conn.commit()
    ok(ctx, { ok: true })
  } catch (e) {
    await conn.rollback()
    fail(ctx, 500, 'reject failed')
  } finally {
    conn.release()
  }
})

// ── 费率套餐管理 ──────────────────────────────────────────────────────────────

// GET /admin/team/rate-plans
router.get('/rate-plans', async (ctx) => {
  const [rows] = await getMysqlPool(ctx.state.env).query<RowDataPacket[]>(
    `SELECT id, name, is_default, l1_rate_pct, l2_rate_pct, l3_rate_pct, created_at, updated_at
     FROM bg_team_rate_plan ORDER BY is_default DESC, id ASC`,
  )
  ok(ctx, { items: rows })
})

// POST /admin/team/rate-plans  { name, l1_rate_pct, l2_rate_pct, l3_rate_pct }
router.post('/rate-plans', async (ctx) => {
  const body = ctx.request.body as { name?: string; l1_rate_pct?: number; l2_rate_pct?: number; l3_rate_pct?: number }
  if (!body?.name) { fail(ctx, 400, 'name required'); return }
  const db = getMysqlPool(ctx.state.env)
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_team_rate_plan (name, is_default, l1_rate_pct, l2_rate_pct, l3_rate_pct)
     VALUES (?, 0, ?, ?, ?)`,
    [body.name, Number(body.l1_rate_pct ?? 0), Number(body.l2_rate_pct ?? 0), Number(body.l3_rate_pct ?? 0)],
  )
  ok(ctx, { id: res.insertId })
})

// PUT /admin/team/rate-plans/:id  { name?, l1_rate_pct?, l2_rate_pct?, l3_rate_pct? }
router.put('/rate-plans/:id', async (ctx) => {
  const id   = Number(ctx.params.id)
  const body = ctx.request.body as Record<string, unknown>
  const db   = getMysqlPool(ctx.state.env)

  const allowed = ['name', 'l1_rate_pct', 'l2_rate_pct', 'l3_rate_pct']
  const sets: string[] = []
  const vals: unknown[] = []
  for (const key of allowed) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(body[key]) }
  }
  if (sets.length === 0) { fail(ctx, 400, 'no valid fields'); return }
  vals.push(id)
  await db.execute<ResultSetHeader>(
    `UPDATE bg_team_rate_plan SET ${sets.join(', ')} WHERE id = ?`,
    vals as unknown as import('mysql2').ExecuteValues,
  )
  ok(ctx, { ok: true })
})

// PUT /admin/team/rate-plans/:id/default  — 设为默认套餐
router.put('/rate-plans/:id/default', async (ctx) => {
  const id = Number(ctx.params.id)
  const db = getMysqlPool(ctx.state.env)
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(`UPDATE bg_team_rate_plan SET is_default = 0`)
    await conn.execute(`UPDATE bg_team_rate_plan SET is_default = 1 WHERE id = ?`, [id])
    await conn.commit()
    ok(ctx, { ok: true })
  } catch (e) {
    await conn.rollback()
    fail(ctx, 500, 'set default failed')
  } finally {
    conn.release()
  }
})

// PUT /admin/team/agents/:userId/rate-plan  { planId: number | null }
router.put('/agents/:userId/rate-plan', async (ctx) => {
  const { userId } = ctx.params
  const body = ctx.request.body as { planId?: number | null }
  const planId = body?.planId ?? null
  const db = getMysqlPool(ctx.state.env)

  if (planId !== null) {
    const [[plan]] = await db.query<RowDataPacket[]>(
      `SELECT id FROM bg_team_rate_plan WHERE id = ? LIMIT 1`, [planId],
    )
    if (!plan) { fail(ctx, 404, 'rate plan not found'); return }
  }

  await db.execute(
    `UPDATE bg_team_node SET rate_plan_id = ? WHERE user_id = ?`,
    [planId, userId],
  )
  ok(ctx, { ok: true })
})

// GET /admin/team/config
router.get('/config', async (ctx) => {
  const [[row]] = await getMysqlPool(ctx.state.env).query<RowDataPacket[]>(
    `SELECT min_activation_cents, min_withdrawal_cents,
            max_commission_per_settlement_cents, settlement_hour,
            last_auto_settlement, commission_basis, updated_at
     FROM bg_team_config WHERE id = 1 LIMIT 1`,
  )
  ok(ctx, row ?? {})
})

// PUT /admin/team/config
router.put('/config', async (ctx) => {
  const body    = ctx.request.body as Record<string, unknown>
  const adminId = (ctx.state as { adminId?: number }).adminId
  const db      = getMysqlPool(ctx.state.env)

  const allowed = ['min_activation_cents', 'min_withdrawal_cents',
                   'max_commission_per_settlement_cents', 'settlement_hour', 'commission_basis']
  const sets: string[] = []
  const vals: unknown[] = []
  for (const key of allowed) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(body[key]) }
  }
  if (sets.length === 0) { fail(ctx, 400, 'no valid fields'); return }
  sets.push('updated_by = ?'); vals.push(adminId ?? null)
  vals.push(1)

  await db.execute<ResultSetHeader>(
    `UPDATE bg_team_config SET ${sets.join(', ')} WHERE id = ?`,
    vals as unknown as import('mysql2').ExecuteValues,
  )
  ok(ctx, { ok: true })
})

// ── 工具函数 ──────────────────────────────────────────────────────────────────
function currentMonthPrefix(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}%`
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default router
