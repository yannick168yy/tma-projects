import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { ok, fail } from '../../utils/response.js'

const router = new Router({ prefix: '/team' })

// GET /admin/team/overview
router.get('/overview', async (ctx) => {
  const db = getMysqlPool(ctx.state.env)
  const period = currentPeriod()

  const [[agents], [commission], [pending]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM bg_team_node WHERE opted_in = 1`,
    ),
    db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(commission_cents), 0) AS total
       FROM bg_team_commission WHERE period = ? AND status = 'paid'`,
      [period],
    ),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_cents), 0) AS total
       FROM bg_team_withdrawal WHERE status = 'pending'`,
    ),
  ])

  ok(ctx, {
    activeAgents:              Number(agents[0]?.cnt ?? 0),
    thisMonthCommissionCents:  Number(commission[0]?.total ?? 0),
    pendingWithdrawalCount:    Number(pending[0]?.cnt ?? 0),
    pendingWithdrawalCents:    Number(pending[0]?.total ?? 0),
  })
})

// GET /admin/team/agents?search=&page=1&pageSize=20
router.get('/agents', async (ctx) => {
  const search   = ctx.query.search ? String(ctx.query.search) : ''
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset   = (page - 1) * pageSize
  const db       = getMysqlPool(ctx.state.env)
  const period   = currentPeriod()

  const where = search ? `AND (u.id LIKE ? OR u.display_name LIKE ?)` : ''
  const params: unknown[] = search ? [`%${search}%`, `%${search}%`] : []

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_team_node tn
     JOIN bg_user u ON u.id = tn.user_id
     WHERE tn.opted_in = 1 ${where}`,
    params,
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.opted_in_at,
            u.display_name,
            (SELECT COUNT(*) FROM bg_team_node WHERE l1_referrer_id = tn.user_id) AS l1_count,
            (SELECT COUNT(*) FROM bg_team_node WHERE l2_referrer_id = tn.user_id) AS l2_count,
            (SELECT COUNT(*) FROM bg_team_node WHERE l3_referrer_id = tn.user_id) AS l3_count,
            COALESCE((SELECT SUM(commission_cents) FROM bg_team_commission
                      WHERE beneficiary_id = tn.user_id AND period = ?), 0) AS this_month_cents,
            COALESCE(tw.lifetime_earned_cents, 0) AS lifetime_cents
     FROM bg_team_node tn
     JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN bg_team_wallet tw ON tw.user_id = tn.user_id
     WHERE tn.opted_in = 1 ${where}
     ORDER BY lifetime_cents DESC
     LIMIT ? OFFSET ?`,
    [period, ...params, pageSize, offset],
  )

  ok(ctx, {
    total: Number(total),
    page,
    pageSize,
    items: rows.map(r => ({
      userId:                r.user_id,
      displayName:           r.display_name,
      l1Count:               Number(r.l1_count),
      l2Count:               Number(r.l2_count),
      l3Count:               Number(r.l3_count),
      thisMonthCommissionCents: Number(r.this_month_cents),
      lifetimeEarnedCents:   Number(r.lifetime_cents),
      optedInAt:             r.opted_in_at,
    })),
  })
})

// GET /admin/team/agents/:userId/tree  ── 三层完整树形（一次性加载）
router.get('/agents/:userId/tree', async (ctx) => {
  const { userId } = ctx.params
  const db = getMysqlPool(ctx.state.env)
  const period = currentPeriod()

  const commJoin = `LEFT JOIN (
    SELECT beneficiary_id, SUM(commission_cents) AS total
    FROM bg_team_commission WHERE period = ?
    GROUP BY beneficiary_id
  ) tc ON tc.beneficiary_id = tn.user_id`

  const [l1Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.opted_in, u.display_name, COALESCE(tc.total, 0) AS month_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id ${commJoin}
     WHERE tn.l1_referrer_id = ? ORDER BY month_cents DESC`,
    [period, userId],
  )
  const [l2Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.opted_in, u.display_name, COALESCE(tc.total, 0) AS month_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id ${commJoin}
     WHERE tn.l2_referrer_id = ? ORDER BY month_cents DESC`,
    [period, userId],
  )
  const [l3Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.opted_in, u.display_name, COALESCE(tc.total, 0) AS month_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id ${commJoin}
     WHERE tn.l3_referrer_id = ? ORDER BY month_cents DESC`,
    [period, userId],
  )

  interface NodeData { userId: string; displayName: string; isAgent: boolean; thisMonthCents: number; children: NodeData[] }

  const l1Map = new Map<string, NodeData>()
  for (const r of l1Rows) {
    l1Map.set(String(r.user_id), {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: Number(r.month_cents), children: [],
    })
  }
  const l2Map = new Map<string, NodeData>()
  for (const r of l2Rows) {
    const node: NodeData = {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: Number(r.month_cents), children: [],
    }
    l2Map.set(node.userId, node)
    l1Map.get(String(r.l1_referrer_id))?.children.push(node)
  }
  for (const r of l3Rows) {
    const node: NodeData = {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: Number(r.month_cents), children: [],
    }
    l2Map.get(String(r.l1_referrer_id))?.children.push(node)
  }

  ok(ctx, { l1Members: [...l1Map.values()] })
})

// GET /admin/team/agents/:userId
router.get('/agents/:userId', async (ctx) => {
  const { userId } = ctx.params
  const db = getMysqlPool(ctx.state.env)

  const [[node], [wallet], periods] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT tn.*, u.display_name FROM bg_team_node tn JOIN bg_user u ON u.id=tn.user_id
       WHERE tn.user_id = ? LIMIT 1`,
      [userId],
    ),
    db.query<RowDataPacket[]>(
      `SELECT available_cents, frozen_cents, lifetime_earned_cents FROM bg_team_wallet WHERE user_id = ?`,
      [userId],
    ),
    db.query<RowDataPacket[]>(
      `SELECT period, SUM(commission_cents) AS total, status
       FROM bg_team_commission WHERE beneficiary_id = ?
       GROUP BY period, status ORDER BY period DESC LIMIT 24`,
      [userId],
    ),
  ])

  if (!node.length) { fail(ctx, 404, 'agent not found'); return }

  ok(ctx, {
    agent:   { ...node[0], wallet: wallet[0] ?? null },
    history: periods[0],
  })
})

// GET /admin/team/commissions?period=&beneficiaryId=&status=&page=1
router.get('/commissions', async (ctx) => {
  const period      = ctx.query.period ? String(ctx.query.period) : ''
  const beneficiary = ctx.query.beneficiaryId ? String(ctx.query.beneficiaryId) : ''
  const status      = ctx.query.status ? String(ctx.query.status) : ''
  const page        = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize    = 50
  const offset      = (page - 1) * pageSize
  const db          = getMysqlPool(ctx.state.env)

  const conditions: string[] = []
  const params: unknown[]    = []
  if (period)      { conditions.push('tc.period = ?');          params.push(period) }
  if (beneficiary) { conditions.push('tc.beneficiary_id = ?');  params.push(beneficiary) }
  if (status)      { conditions.push('tc.status = ?');          params.push(status) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_team_commission tc ${where}`,
    params,
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

// POST /admin/team/settle  { period }
router.post('/settle', async (ctx) => {
  const body   = ctx.request.body as { period?: string }
  const period = body?.period ?? currentPeriod()
  if (!/^\d{4}-\d{2}$/.test(period)) { fail(ctx, 400, 'period 格式应为 YYYY-MM'); return }

  const res = await fetch(`${ctx.state.env.CORE_NODE_URL}/internal/team/settle`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN },
    body:    JSON.stringify({ period }),
  })
  if (!res.ok) { fail(ctx, 502, 'core-node settlement trigger failed'); return }
  ok(ctx, { message: `settlement triggered for ${period}` })
})

// GET /admin/team/withdrawals?status=&page=1
router.get('/withdrawals', async (ctx) => {
  const status   = ctx.query.status ? String(ctx.query.status) : ''
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = 20
  const offset   = (page - 1) * pageSize
  const db       = getMysqlPool(ctx.state.env)

  const where  = status ? 'WHERE tw.status = ?' : ''
  const params = status ? [status] : []

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_team_withdrawal tw ${where}`, params,
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tw.*, u.display_name
     FROM bg_team_withdrawal tw
     JOIN bg_user u ON u.id = tw.user_id
     ${where}
     ORDER BY tw.status='pending' DESC, tw.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  ok(ctx, { total: Number(total), page, pageSize, items: rows })
})

// POST /admin/team/withdrawals/:id/approve
router.post('/withdrawals/:id/approve', async (ctx) => {
  const id       = Number(ctx.params.id)
  const adminId  = (ctx.state as { adminId?: number }).adminId

  const res = await fetch(`${ctx.state.env.CORE_NODE_URL}/internal/team/withdrawal/approve`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN },
    body:    JSON.stringify({ withdrawalId: id }),
  })
  if (!res.ok) { fail(ctx, 502, 'withdrawal approval failed'); return }

  // 记录 admin_id
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
    `SELECT user_id, amount_cents, status FROM bg_team_withdrawal WHERE id = ? LIMIT 1`,
    [id],
  )
  if (!wd) { fail(ctx, 404, 'not found'); return }
  if (wd.status !== 'pending') { fail(ctx, 409, 'already processed'); return }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // 解冻团队钱包
    await conn.execute(
      `UPDATE bg_team_wallet
       SET frozen_cents = frozen_cents - ?,
           available_cents = available_cents + ?
       WHERE user_id = ?`,
      [wd.amount_cents, wd.amount_cents, wd.user_id],
    )
    await conn.execute(
      `UPDATE bg_team_withdrawal
       SET status = 'rejected', reject_reason = ?, admin_id = ?, reviewed_at = NOW(3)
       WHERE id = ?`,
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

// GET /admin/team/config
router.get('/config', async (ctx) => {
  const [[row]] = await getMysqlPool(ctx.state.env).query<RowDataPacket[]>(
    `SELECT l1_rate_pct, l2_rate_pct, l3_rate_pct,
            min_activation_cents, min_withdrawal_cents,
            max_commission_per_settlement_cents, settlement_day, updated_at
     FROM bg_team_config WHERE id = 1 LIMIT 1`,
  )
  ok(ctx, row ?? {})
})

// PUT /admin/team/config
router.put('/config', async (ctx) => {
  const body    = ctx.request.body as Record<string, unknown>
  const adminId = (ctx.state as { adminId?: number }).adminId
  const db      = getMysqlPool(ctx.state.env)

  const allowed = ['l1_rate_pct', 'l2_rate_pct', 'l3_rate_pct',
                   'min_activation_cents', 'min_withdrawal_cents',
                   'max_commission_per_settlement_cents', 'settlement_day']
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
    vals as import('mysql2').ExecuteValues,
  )
  ok(ctx, { ok: true })
})

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default router
