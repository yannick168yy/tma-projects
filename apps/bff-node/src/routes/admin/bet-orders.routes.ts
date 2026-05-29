import Router from '@koa/router'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/bet-orders' })

router.get('/', async (ctx) => {
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset   = (page - 1) * pageSize
  const userId   = ctx.query.userId   ? String(ctx.query.userId)   : undefined
  const status   = ctx.query.status   ? String(ctx.query.status)   : undefined
  const betType  = ctx.query.betType  ? String(ctx.query.betType)  : undefined
  const dateFrom = ctx.query.dateFrom ? String(ctx.query.dateFrom) : undefined
  const dateTo   = ctx.query.dateTo   ? String(ctx.query.dateTo)   : undefined

  const where: string[] = []
  const params: unknown[] = []

  if (userId)   { where.push('user_id = ?');              params.push(userId) }
  if (status)   { where.push('status = ?');               params.push(status) }
  if (betType)  { where.push('bet_type = ?');             params.push(betType) }
  if (dateFrom) { where.push('created_at >= ?');          params.push(dateFrom + ' 00:00:00') }
  if (dateTo)   { where.push('created_at <= ?');          params.push(dateTo   + ' 23:59:59') }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const pool = getMysqlPool(ctx.state.env)

  const [[{ total }]] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_bet_order ${whereClause}`,
    params,
  )
  const [items] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT id, user_id, aggregator_id, provider_id, provider_txn_id,
            round_id, bet_type, amount, currency_code,
            original_amount, exchange_rate, status, created_at, settled_at
     FROM bg_bet_order ${whereClause}
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  // 当页统计（仅 bet/win 类型参与 GGR 计算）
  const [[stats]] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN bet_type='bet'  THEN amount ELSE 0 END), 0) AS totalBet,
       COALESCE(SUM(CASE WHEN bet_type='win'  THEN amount ELSE 0 END), 0) AS totalWin,
       COUNT(DISTINCT round_id) AS roundCount
     FROM bg_bet_order ${whereClause}`,
    params,
  )

  const mapped = items.map((r) => ({
    id: r.id,
    userId: String(r.user_id),
    aggregatorId: r.aggregator_id ? String(r.aggregator_id) : null,
    providerId: r.provider_id ? String(r.provider_id) : null,
    providerTxnId: r.provider_txn_id ? String(r.provider_txn_id) : null,
    roundId: r.round_id ? String(r.round_id) : null,
    betType: r.bet_type,
    amount: Number(r.amount),
    currencyCode: String(r.currency_code),
    originalAmount: r.original_amount != null ? Number(r.original_amount) : null,
    exchangeRate: r.exchange_rate != null ? Number(r.exchange_rate) : null,
    status: r.status,
    createdAt: (() => { const d = new Date(r.created_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    settledAt: r.settled_at ? (() => { const d = new Date(r.settled_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })() : null,
  }))

  ok(ctx, {
    total: Number(total),
    page,
    pageSize,
    stats: {
      totalBet:   Number(stats.totalBet),
      totalWin:   Number(stats.totalWin),
      roundCount: Number(stats.roundCount),
    },
    items: mapped,
  })
})

export default router
