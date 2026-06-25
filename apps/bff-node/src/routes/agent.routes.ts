import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import { ok, fail } from '../utils/response.js'

const router = new Router({ prefix: '/agent' })

// GET /api/v1/agent/center  代理中心（仅代理本人可见，只读报表）
router.get('/center', async (ctx) => {
  const userId = ctx.state.userId!
  const db = getMysqlPool(ctx.state.env)

  const [[agent]] = await db.query<RowDataPacket[]>(
    `SELECT agent_id, name, ggr_rate_pct, status FROM bg_agent WHERE agent_id = ?`,
    [userId],
  )
  if (!agent || agent.status !== 'active') { fail(ctx, 403, 'errors.notAgent', 403); return }

  const [channels] = await db.query<RowDataPacket[]>(
    `SELECT 'domain' AS channel_type, domain AS channel_value, enabled, created_at
       FROM bg_agent_domain WHERE agent_id = ? AND enabled = 1
     UNION ALL
     SELECT 'bot' AS channel_type, bot_username AS channel_value, enabled, created_at
       FROM bg_agent_bot WHERE agent_id = ? AND enabled = 1
     ORDER BY created_at DESC`,
    [userId, userId],
  )
  const [[userCount]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM bg_user_agent WHERE agent_id = ?`, [userId],
  )
  const [commissions] = await db.query<RowDataPacket[]>(
    `SELECT period, ggr_cents, commission_cents, status, paid_at
     FROM bg_agent_commission WHERE agent_id = ? ORDER BY period DESC LIMIT 12`,
    [userId],
  )
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(commission_cents),0) AS lifetime_commission_cents,
            COALESCE(SUM(CASE WHEN status='pending' THEN commission_cents ELSE 0 END),0) AS pending_cents
     FROM bg_agent_commission WHERE agent_id = ?`,
    [userId],
  )

  ok(ctx, {
    agent: { name: agent.name, ggrRatePct: Number(agent.ggr_rate_pct) },
    userCount: Number(userCount?.cnt ?? 0),
    channels,
    commissions,
    summary,
  })
})

// GET /api/v1/agent/users?page=&pageSize=  名下用户（含本月 GGR，仅代理本人可见）
router.get('/users', async (ctx) => {
  const userId = ctx.state.userId!
  const db = getMysqlPool(ctx.state.env)

  const [[agent]] = await db.query<RowDataPacket[]>(
    `SELECT status FROM bg_agent WHERE agent_id = ?`, [userId],
  )
  if (!agent || agent.status !== 'active') { fail(ctx, 403, 'errors.notAgent', 403); return }

  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(50, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset = (page - 1) * pageSize

  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const start = `${y}-${String(m).padStart(2, '0')}-01 00:00:00`
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const end = `${ny}-${String(nm).padStart(2, '0')}-01 00:00:00`

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_user_agent WHERE agent_id = ?`, [userId],
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ua.user_id, ua.bound_at, u.display_name,
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
    [start, end, start, end, userId, pageSize, offset],
  )
  ok(ctx, { total: Number(total), page, pageSize, items: rows })
})

export default router
