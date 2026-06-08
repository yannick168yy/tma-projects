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
      `SELECT COALESCE(SUM(php_equivalent_cents), 0) AS total
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
            COALESCE((SELECT SUM(php_equivalent_cents) FROM bg_team_commission
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

// GET /admin/team/agents/:userId/tree?period=YYYY-MM  ── 三层完整树形（一次性加载）
router.get('/agents/:userId/tree', async (ctx) => {
  const { userId } = ctx.params
  const period = ctx.query.period ? String(ctx.query.period) : currentPeriod()
  const db = getMysqlPool(ctx.state.env)

  const [year, month] = period.split('-').map(Number)
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000
  const startDate = new Date(Date.UTC(year, month - 1, 1) - PHT_OFFSET_MS)
  const endDate   = new Date(Date.UTC(year, month,     1) - PHT_OFFSET_MS)

  const [[cfg]] = await db.query<RowDataPacket[]>(
    `SELECT l1_rate_pct, l2_rate_pct, l3_rate_pct FROM bg_team_config WHERE id = 1 LIMIT 1`
  )
  const rates = [0, Number(cfg?.l1_rate_pct ?? 25), Number(cfg?.l2_rate_pct ?? 8), Number(cfg?.l3_rate_pct ?? 3)]

  const env = ctx.state.env
  function fxRate(currency: string): number {
    const u = currency.toUpperCase()
    if (u === 'PHP') return 1
    if (u === 'EUR') return Number(env.EUR_TO_PHP_RATE)
    if (u === 'USDT' || u === 'USD' || u === 'USDC') return Number(env.USDT_TO_PHP_RATE)
    if (u === 'TON') return Number(env.TON_TO_PHP_RATE)
    if (u === 'TRX' || u === 'TRX_TESTNET') return Number(env.TRX_TO_PHP_RATE)
    if (u === 'BNB') return Number(env.BNB_TO_PHP_RATE)
    if (u === 'ETH') return Number(env.ETH_TO_PHP_RATE)
    if (u === 'BTC') return Number(env.BTC_TO_PHP_RATE)
    return 1
  }

  type GgrBreakdownItem = { currency: string; ggrCents: number }

  function parseBreakdown(raw: unknown): GgrBreakdownItem[] {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? [])
    return (arr as GgrBreakdownItem[]).filter((b: GgrBreakdownItem) => b.ggrCents !== 0)
  }

  function toPhpGgr(breakdown: GgrBreakdownItem[]): number {
    return breakdown.reduce((sum, b) => sum + Math.round(b.ggrCents * fxRate(b.currency)), 0)
  }

  function ggrSub(levelCol: string) {
    return `
      SELECT pc.user_id,
             ROUND(SUM(pc.ggr_amount) * 100) AS ggr_cents,
             JSON_ARRAYAGG(JSON_OBJECT('currency', pc.currency_code, 'ggrCents', ROUND(pc.ggr_amount * 100))) AS ggr_breakdown
      FROM (
        SELECT bo.user_id, bo.currency_code,
               SUM(CASE WHEN bo.bet_type='bet' THEN bo.amount ELSE 0 END) -
               SUM(CASE WHEN bo.bet_type='win' THEN bo.amount ELSE 0 END) AS ggr_amount
        FROM bg_bet_order bo
        JOIN bg_team_node tm ON tm.user_id = bo.user_id AND tm.${levelCol} = ?
        WHERE bo.created_at >= ? AND bo.created_at < ?
          AND bo.bet_type IN ('bet','win') AND bo.status = 'settled'
        GROUP BY bo.user_id, bo.currency_code
      ) pc
      GROUP BY pc.user_id`
  }

  function commSub(level: number) {
    return `
      SELECT from_user_id, SUM(php_equivalent_cents) AS commission_cents
      FROM bg_team_commission
      WHERE period = ? AND beneficiary_id = ? AND level = ${level}
      GROUP BY from_user_id`
  }

  const [l1Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.opted_in, tn.activated, u.display_name,
            COALESCE(g.ggr_cents, 0) AS ggr_cents, g.ggr_breakdown,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${ggrSub('l1_referrer_id')}) g ON g.user_id = tn.user_id
     LEFT JOIN (${commSub(1)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l1_referrer_id = ? ORDER BY ggr_cents DESC`,
    [userId, startDate, endDate, period, userId, userId],
  )
  const [l2Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.opted_in, tn.activated, u.display_name,
            COALESCE(g.ggr_cents, 0) AS ggr_cents, g.ggr_breakdown,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${ggrSub('l2_referrer_id')}) g ON g.user_id = tn.user_id
     LEFT JOIN (${commSub(2)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l2_referrer_id = ? ORDER BY ggr_cents DESC`,
    [userId, startDate, endDate, period, userId, userId],
  )
  const [l3Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.opted_in, tn.activated, u.display_name,
            COALESCE(g.ggr_cents, 0) AS ggr_cents, g.ggr_breakdown,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${ggrSub('l3_referrer_id')}) g ON g.user_id = tn.user_id
     LEFT JOIN (${commSub(3)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l3_referrer_id = ? ORDER BY ggr_cents DESC`,
    [userId, startDate, endDate, period, userId, userId],
  )

  interface NodeData { userId: string; displayName: string; isAgent: boolean; thisMonthCents: number; ggrCents: number; ggrBreakdown: GgrBreakdownItem[]; children: NodeData[] }

  function toCommCents(raw: unknown, phpGgrCents: number, level: 1 | 2 | 3, activated: boolean): number {
    if (raw !== null && raw !== undefined) return Number(raw)
    if (!activated) return 0
    return Math.round(phpGgrCents * rates[level] / 100)
  }

  const l1Map = new Map<string, NodeData>()
  for (const r of l1Rows) {
    const breakdown = parseBreakdown(r.ggr_breakdown)
    const phpGgrCents = toPhpGgr(breakdown)
    l1Map.set(String(r.user_id), {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: toCommCents(r.commission_cents, phpGgrCents, 1, Boolean(r.activated)),
      ggrCents: phpGgrCents, ggrBreakdown: breakdown, children: [],
    })
  }
  const l2Map = new Map<string, NodeData>()
  for (const r of l2Rows) {
    const breakdown = parseBreakdown(r.ggr_breakdown)
    const phpGgrCents = toPhpGgr(breakdown)
    const node: NodeData = {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: toCommCents(r.commission_cents, phpGgrCents, 2, Boolean(r.activated)),
      ggrCents: phpGgrCents, ggrBreakdown: breakdown, children: [],
    }
    l2Map.set(node.userId, node)
    l1Map.get(String(r.l1_referrer_id))?.children.push(node)
  }
  for (const r of l3Rows) {
    const breakdown = parseBreakdown(r.ggr_breakdown)
    const phpGgrCents = toPhpGgr(breakdown)
    const node: NodeData = {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: toCommCents(r.commission_cents, phpGgrCents, 3, Boolean(r.activated)),
      ggrCents: phpGgrCents, ggrBreakdown: breakdown, children: [],
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
            max_commission_per_settlement_cents, settlement_day, settlement_hour,
            last_auto_settlement, updated_at
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
                   'max_commission_per_settlement_cents', 'settlement_day', 'settlement_hour']
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
