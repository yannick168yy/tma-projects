import Router from '@koa/router'
import { getMysqlPool } from '../clients/mysql.client.js'
import { ok } from '../utils/response.js'

const router = new Router({ prefix: '/bets' })

router.get('/', async (ctx) => {
  const userId   = ctx.state.userId!
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(50, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset   = (page - 1) * pageSize

  const pool = getMysqlPool(ctx.state.env)

  const [[{ total }]] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM bg_bet_order WHERE user_id = ?',
    [userId],
  )

  const [items] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT id, round_id, provider_id, bet_type, amount, currency_code, status, created_at
     FROM bg_bet_order
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )

  ok(ctx, {
    total: Number(total),
    page,
    pageSize,
    items: items.map((r) => ({
      id: r.id,
      roundId: r.round_id ? String(r.round_id) : null,
      providerId: r.provider_id ? String(r.provider_id) : null,
      betType: r.bet_type as string,
      amount: Number(r.amount),
      currencyCode: String(r.currency_code),
      status: r.status as string,
      createdAt: (() => { const d = new Date(r.created_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    })),
  })
})

export default router
