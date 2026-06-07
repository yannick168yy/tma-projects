import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import { ok, fail } from '../utils/response.js'
import { nowMysql } from '../utils/format.js'

const router = new Router({ prefix: '/promotions/team' })

// GET /promotions/team/status
router.get('/status', async (ctx) => {
  const userId = ctx.state.userId!
  const db = getMysqlPool(ctx.state.env)

  const [[node], [wallet]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT opted_in, activated, l1_referrer_id, l2_referrer_id, l3_referrer_id
       FROM bg_team_node WHERE user_id = ? LIMIT 1`,
      [userId],
    ),
    db.query<RowDataPacket[]>(
      `SELECT available_cents, lifetime_earned_cents
       FROM bg_team_wallet WHERE user_id = ? AND currency = 'PHP' LIMIT 1`,
      [userId],
    ),
  ])

  if (!node.length || !node[0].opted_in) {
    ok(ctx, { isAgent: false, activated: false, l1Count: 0, l2Count: 0, l3Count: 0, availableCents: 0, lifetimeEarnedCents: 0 })
    return
  }

  // 统计全部下线人数（含未激活），与 /downlines 接口口径一致；
  // 激活情况通过 downlines 列表的 activated 字段体现
  const [counts] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(l1_referrer_id = ?) AS l1Count,
       SUM(l2_referrer_id = ?) AS l2Count,
       SUM(l3_referrer_id = ?) AS l3Count
     FROM bg_team_node`,
    [userId, userId, userId],
  )

  ok(ctx, {
    isAgent:              true,
    activated:            !!node[0].activated,
    l1Count:              Number(counts[0]?.l1Count ?? 0),
    l2Count:              Number(counts[0]?.l2Count ?? 0),
    l3Count:              Number(counts[0]?.l3Count ?? 0),
    availableCents:       Number(wallet[0]?.available_cents ?? 0),
    lifetimeEarnedCents:  Number(wallet[0]?.lifetime_earned_cents ?? 0),
  })
})

// POST /promotions/team/enable
router.post('/enable', async (ctx) => {
  const userId = ctx.state.userId!
  const db = getMysqlPool(ctx.state.env)
  const now = nowMysql()

  // 查用户三级上线链（注册时已有 inviter_id）
  const [[user]] = await db.query<RowDataPacket[]>(
    `SELECT u.inviter_id AS l1_id, l1.inviter_id AS l2_id, l2.inviter_id AS l3_id
     FROM bg_user u
     LEFT JOIN bg_user l1 ON l1.id = u.inviter_id
     LEFT JOIN bg_user l2 ON l2.id = l1.inviter_id
     WHERE u.id = ? LIMIT 1`,
    [userId],
  )

  if (!user) {
    fail(ctx, 404, 'User not found')
    return
  }

  // INSERT 归属树行（若不存在），或仅更新 opted_in
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_team_node
       (user_id, l1_referrer_id, l2_referrer_id, l3_referrer_id, opted_in, opted_in_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE opted_in = 1, opted_in_at = COALESCE(opted_in_at, VALUES(opted_in_at))`,
    [userId, user.l1_id ?? null, user.l2_id ?? null, user.l3_id ?? null, now],
  )

  // 确保佣金钱包（PHP）存在
  await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO bg_team_wallet (user_id, currency) VALUES (?, 'PHP')`,
    [userId],
  )

  ok(ctx, { isAgent: true })
})

// GET /promotions/team/downlines?level=1&page=1
router.get('/downlines', async (ctx) => {
  const userId = ctx.state.userId!
  const level  = Math.min(3, Math.max(1, Number(ctx.query.level ?? 1)))
  const page   = Math.max(1, Number(ctx.query.page ?? 1))
  const size   = 20
  const offset = (page - 1) * size
  const col    = `l${level}_referrer_id`
  const db     = getMysqlPool(ctx.state.env)

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_team_node WHERE ${col} = ?`,
    [userId],
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.activated, tn.activated_at, tn.created_at,
            u.display_name
     FROM bg_team_node tn
     JOIN bg_user u ON u.id = tn.user_id
     WHERE tn.${col} = ?
     ORDER BY tn.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, size, offset],
  )

  ok(ctx, {
    total: Number(total),
    page,
    items: rows.map(r => ({
      userId:      r.user_id,
      displayName: r.display_name,
      activated:   !!r.activated,
      activatedAt: r.activated_at ?? null,
      registeredAt: r.created_at,
    })),
  })
})

// GET /promotions/team/commissions?period=2026-06
router.get('/commissions', async (ctx) => {
  const userId = ctx.state.userId!
  const period = String(ctx.query.period ?? currentPeriod())
  const db     = getMysqlPool(ctx.state.env)

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT tc.*, u.display_name
     FROM bg_team_commission tc
     JOIN bg_user u ON u.id = tc.from_user_id
     WHERE tc.beneficiary_id = ? AND tc.period = ?
     ORDER BY tc.commission_cents DESC`,
    [userId, period],
  )

  const summary = { l1Cents: 0, l2Cents: 0, l3Cents: 0, totalCents: 0, paidCents: 0 }
  for (const r of rows) {
    const c = Number(r.commission_cents)
    if (r.level === 1) summary.l1Cents += c
    else if (r.level === 2) summary.l2Cents += c
    else summary.l3Cents += c
    summary.totalCents += c
    if (r.status === 'paid') summary.paidCents += c
  }

  ok(ctx, {
    period,
    summary,
    items: rows.map(r => ({
      fromUserId:        r.from_user_id,
      displayName:       r.display_name,
      level:             r.level,
      currency:          r.currency ?? 'PHP',
      ggrCents:          Number(r.ggr_cents),
      phpEquivCents:     Number(r.php_equivalent_cents ?? r.ggr_cents),
      ratePct:           Number(r.rate_pct),
      commissionCents:   Number(r.commission_cents),
      status:            r.status,
      paidAt:            r.paid_at ?? null,
    })),
  })
})

// GET /promotions/team/wallet
router.get('/wallet', async (ctx) => {
  const userId = ctx.state.userId!
  const db     = getMysqlPool(ctx.state.env)
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT available_cents, frozen_cents, lifetime_earned_cents
     FROM bg_team_wallet WHERE user_id = ? AND currency = 'PHP' LIMIT 1`,
    [userId],
  )
  ok(ctx, {
    availableCents:      Number(row?.available_cents ?? 0),
    frozenCents:         Number(row?.frozen_cents ?? 0),
    lifetimeEarnedCents: Number(row?.lifetime_earned_cents ?? 0),
  })
})

// POST /promotions/team/withdraw  { amount_cents }
router.post('/withdraw', async (ctx) => {
  const userId     = ctx.state.userId!
  const body       = ctx.request.body as { amount_cents?: number }
  const amountCents = Number(body?.amount_cents ?? 0)
  if (amountCents <= 0) { fail(ctx, 400, 'amount_cents must be positive'); return }

  const db = getMysqlPool(ctx.state.env)
  const [[cfg]] = await db.query<RowDataPacket[]>(
    `SELECT min_withdrawal_cents FROM bg_team_config WHERE id = 1 LIMIT 1`,
  )
  if (amountCents < Number(cfg?.min_withdrawal_cents ?? 5000)) {
    fail(ctx, 400, `最低提现 ₱${(Number(cfg?.min_withdrawal_cents ?? 5000) / 100).toFixed(0)}`); return
  }

  // 乐观锁扣款（最多重试3次）
  let withdrawalId: number | null = null
  for (let i = 0; i < 3; i++) {
    const [[wallet]] = await db.query<RowDataPacket[]>(
      `SELECT available_cents, version FROM bg_team_wallet WHERE user_id = ? AND currency = 'PHP' LIMIT 1`,
      [userId],
    )
    if (!wallet) { fail(ctx, 400, '可提余额不足'); return }
    const available = Number(wallet.available_cents)
    if (available < 0) { fail(ctx, 400, '账户存在欠款，请先联系客服处理'); return }
    if (available < amountCents) { fail(ctx, 400, '可提余额不足'); return }
    const [res] = await db.execute<import('mysql2/promise').ResultSetHeader>(
      `UPDATE bg_team_wallet
       SET available_cents = available_cents - ?,
           frozen_cents    = frozen_cents + ?,
           version = version + 1
       WHERE user_id = ? AND currency = 'PHP' AND version = ? AND available_cents >= ?`,
      [amountCents, amountCents, userId, wallet.version, amountCents],
    )
    if (res.affectedRows > 0) {
      const [ins] = await db.execute<import('mysql2/promise').ResultSetHeader>(
        `INSERT INTO bg_team_withdrawal (user_id, amount_cents) VALUES (?, ?)`,
        [userId, amountCents],
      )
      withdrawalId = ins.insertId
      break
    }
  }
  if (!withdrawalId) { fail(ctx, 500, '提现申请失败，请重试'); return }
  ok(ctx, { withdrawalId })
})

// GET /promotions/team/withdrawals?page=1
router.get('/withdrawals', async (ctx) => {
  const userId = ctx.state.userId!
  const page   = Math.max(1, Number(ctx.query.page ?? 1))
  const size   = 20
  const offset = (page - 1) * size
  const db     = getMysqlPool(ctx.state.env)

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_team_withdrawal WHERE user_id = ?`,
    [userId],
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, amount_cents, status, reject_reason, reviewed_at, created_at
     FROM bg_team_withdrawal WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, size, offset],
  )
  ok(ctx, { total: Number(total), page, items: rows.map(r => ({
    id:           r.id,
    amountCents:  Number(r.amount_cents),
    status:       r.status,
    rejectReason: r.reject_reason ?? null,
    reviewedAt:   r.reviewed_at ?? null,
    createdAt:    r.created_at,
  })) })
})

// GET /promotions/team/tree?period=YYYY-MM
router.get('/tree', async (ctx) => {
  const userId = ctx.state.userId!
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
      SELECT from_user_id, SUM(commission_cents) AS commission_cents
      FROM bg_team_commission
      WHERE period = ? AND beneficiary_id = ? AND level = ${level}
      GROUP BY from_user_id`
  }

  const [l1Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.opted_in, u.display_name,
            COALESCE(g.ggr_cents, 0) AS ggr_cents, g.ggr_breakdown,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${ggrSub('l1_referrer_id')}) g ON g.user_id = tn.user_id
     LEFT JOIN (${commSub(1)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l1_referrer_id = ? ORDER BY ggr_cents DESC`,
    [userId, startDate, endDate, period, userId, userId],
  )
  const [l2Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.opted_in, u.display_name,
            COALESCE(g.ggr_cents, 0) AS ggr_cents, g.ggr_breakdown,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${ggrSub('l2_referrer_id')}) g ON g.user_id = tn.user_id
     LEFT JOIN (${commSub(2)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l2_referrer_id = ? ORDER BY ggr_cents DESC`,
    [userId, startDate, endDate, period, userId, userId],
  )
  const [l3Rows] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.opted_in, u.display_name,
            COALESCE(g.ggr_cents, 0) AS ggr_cents, g.ggr_breakdown,
            c.commission_cents
     FROM bg_team_node tn JOIN bg_user u ON u.id = tn.user_id
     LEFT JOIN (${ggrSub('l3_referrer_id')}) g ON g.user_id = tn.user_id
     LEFT JOIN (${commSub(3)}) c ON c.from_user_id = tn.user_id
     WHERE tn.l3_referrer_id = ? ORDER BY ggr_cents DESC`,
    [userId, startDate, endDate, period, userId, userId],
  )

  type GgrBreakdownItem = { currency: string; ggrCents: number }
  interface NodeData { userId: string; displayName: string; isAgent: boolean; thisMonthCents: number; ggrCents: number; ggrBreakdown: GgrBreakdownItem[]; children: NodeData[] }

  function parseBreakdown(raw: unknown): GgrBreakdownItem[] {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? [])
    return (arr as GgrBreakdownItem[]).filter(b => b.ggrCents !== 0)
  }

  function toCommCents(raw: unknown, ggrCents: number, level: 1 | 2 | 3): number {
    if (raw !== null && raw !== undefined) return Number(raw)
    return Math.round(ggrCents * rates[level] / 100)
  }

  const l1Map = new Map<string, NodeData>()
  for (const r of l1Rows) {
    const ggrCents = Number(r.ggr_cents)
    l1Map.set(String(r.user_id), {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: toCommCents(r.commission_cents, ggrCents, 1),
      ggrCents, ggrBreakdown: parseBreakdown(r.ggr_breakdown), children: [],
    })
  }
  const l2Map = new Map<string, NodeData>()
  for (const r of l2Rows) {
    const ggrCents = Number(r.ggr_cents)
    const node: NodeData = {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: toCommCents(r.commission_cents, ggrCents, 2),
      ggrCents, ggrBreakdown: parseBreakdown(r.ggr_breakdown), children: [],
    }
    l2Map.set(node.userId, node)
    l1Map.get(String(r.l1_referrer_id))?.children.push(node)
  }
  for (const r of l3Rows) {
    const ggrCents = Number(r.ggr_cents)
    const node: NodeData = {
      userId: String(r.user_id), displayName: String(r.display_name),
      isAgent: Boolean(r.opted_in), thisMonthCents: toCommCents(r.commission_cents, ggrCents, 3),
      ggrCents, ggrBreakdown: parseBreakdown(r.ggr_breakdown), children: [],
    }
    l2Map.get(String(r.l1_referrer_id))?.children.push(node)
  }

  ok(ctx, { l1Members: [...l1Map.values()] })
})

// ── 工具函数 ──────────────────────────────────────────────────────────────
function maskName(name: string): string {
  if (!name) return '***'
  if (name.length <= 2) return name[0] + '***'
  return name[0] + name[1] + '***' + name[name.length - 1]
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default router
