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
  if (!agent || agent.status !== 'active') { fail(ctx, 403, '非代理用户', 403); return }

  const [channels] = await db.query<RowDataPacket[]>(
    `SELECT channel_type, channel_value, enabled FROM bg_agent_channel
     WHERE agent_id = ? AND enabled = 1 ORDER BY created_at DESC`,
    [userId],
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

export default router
