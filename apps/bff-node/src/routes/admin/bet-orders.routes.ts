import Router from '@koa/router'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/bet-orders' })

router.get('/', async (ctx) => {
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(1000, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset   = (page - 1) * pageSize
  const view     = ctx.query.view === 'round' ? 'round' : 'detail'
  const userId   = ctx.query.userId   ? String(ctx.query.userId)   : undefined
  const status   = ctx.query.status   ? String(ctx.query.status)   : undefined
  const betType  = ctx.query.betType  ? String(ctx.query.betType)  : undefined
  const dateFrom = ctx.query.dateFrom ? String(ctx.query.dateFrom) : undefined
  const dateTo   = ctx.query.dateTo   ? String(ctx.query.dateTo)   : undefined

  const pool = getMysqlPool(ctx.state.env)

  // stats 始终只按 userId/日期过滤，两个视图共用，保持数字一致
  const statsWhere: string[] = []
  const statsParams: unknown[] = []
  if (userId)   { statsWhere.push('b.user_id = ?');     statsParams.push(userId) }
  if (dateFrom) { statsWhere.push('b.created_at >= ?'); statsParams.push(dateFrom + ' 00:00:00') }
  if (dateTo)   { statsWhere.push('b.created_at <= ?'); statsParams.push(dateTo   + ' 23:59:59') }
  const statsWhereClause = statsWhere.length ? 'WHERE ' + statsWhere.join(' AND ') : ''

  const [[sharedStats]] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN b.bet_type='bet' THEN b.amount ELSE 0 END), 0) AS totalBet,
       COALESCE(SUM(CASE WHEN b.bet_type='win' THEN b.amount ELSE 0 END), 0) AS totalWin,
       COUNT(DISTINCT COALESCE(b.round_id, b.provider_txn_id)) AS roundCount
     FROM bg_bet_order b ${statsWhereClause}`,
    statsParams,
  )
  const stats = { totalBet: Number(sharedStats.totalBet), totalWin: Number(sharedStats.totalWin), roundCount: Number(sharedStats.roundCount) }

  // ── 按局视图 ────────────────────────────────────────────────────────────────
  if (view === 'round') {
    const innerWhere: string[] = []
    const innerParams: unknown[] = []
    if (userId)   { innerWhere.push('b.user_id = ?');     innerParams.push(userId) }
    if (dateFrom) { innerWhere.push('b.created_at >= ?'); innerParams.push(dateFrom + ' 00:00:00') }
    if (dateTo)   { innerWhere.push('b.created_at <= ?'); innerParams.push(dateTo   + ' 23:59:59') }
    const innerWhereClause = innerWhere.length ? 'WHERE ' + innerWhere.join(' AND ') : ''

    // 无局号的单以 provider_txn_id 作为独立一局保留，不丢数据
    const [[{ total }]] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM (
         SELECT 1 FROM bg_bet_order b ${innerWhereClause}
         GROUP BY COALESCE(b.round_id, b.provider_txn_id), b.user_id, b.currency_code
       ) sub`,
      innerParams,
    )
    const [items] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
      `SELECT r.round_id, r.user_id, r.currency_code, r.provider_id,
              r.bet_amount, r.win_amount, r.cancel_count, r.bet_time, r.win_time,
              (SELECT COALESCE(o.name_override, g.name_en, g.name_zh)
                 FROM bg_568win_game g
                 LEFT JOIN bg_568win_game_override o
                   ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
                WHERE g.game_id = r.provider_id LIMIT 1) AS game_name,
              (SELECT COALESCE(g.provider, '568Win') FROM bg_568win_game g
                WHERE g.game_id = r.provider_id LIMIT 1) AS provider_name
       FROM (
         SELECT COALESCE(b.round_id, b.provider_txn_id) AS round_id,
           b.user_id, b.currency_code, MIN(b.provider_id) AS provider_id,
           SUM(CASE WHEN b.bet_type='bet' THEN b.amount ELSE 0 END) AS bet_amount,
           SUM(CASE WHEN b.bet_type IN ('win','refund') THEN b.amount ELSE 0 END) AS win_amount,
           SUM(CASE WHEN b.bet_type='cancel' THEN 1 ELSE 0 END)     AS cancel_count,
           MIN(CASE WHEN b.bet_type='bet' THEN b.created_at END)    AS bet_time,
           MIN(CASE WHEN b.bet_type IN ('win','refund') THEN b.created_at END) AS win_time
         FROM bg_bet_order b ${innerWhereClause}
         GROUP BY COALESCE(b.round_id, b.provider_txn_id), b.user_id, b.currency_code
       ) r
       ORDER BY COALESCE(r.bet_time, r.win_time) DESC LIMIT ? OFFSET ?`,
      [...innerParams, pageSize, offset],
    )
    const toIso = (v: unknown) => {
      if (!v) return null
      const d = new Date(v as Date)
      return isNaN(d.getTime()) ? null : d.toISOString()
    }
    ok(ctx, {
      total: Number(total), page, pageSize,
      stats,
      items: items.map((r) => ({
        roundId:      String(r.round_id),
        userId:       String(r.user_id),
        currencyCode: String(r.currency_code),
        betAmount:    Number(r.bet_amount),
        winAmount:    Number(r.win_amount),
        cancelled:    Number(r.cancel_count) > 0,
        gameName:     r.game_name     ? String(r.game_name)     : null,
        providerName: r.provider_name ? String(r.provider_name) : null,
        betTime:      toIso(r.bet_time),
        winTime:      toIso(r.win_time),
      })),
    })
    return
  }

  // ── 明细视图 ────────────────────────────────────────────────────────────────
  const where: string[] = []
  const params: unknown[] = []

  if (userId)   { where.push('b.user_id = ?');     params.push(userId) }
  if (status)   { where.push('b.status = ?');      params.push(status) }
  if (betType)  { where.push('b.bet_type = ?');    params.push(betType) }
  if (dateFrom) { where.push('b.created_at >= ?'); params.push(dateFrom + ' 00:00:00') }
  if (dateTo)   { where.push('b.created_at <= ?'); params.push(dateTo   + ' 23:59:59') }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const [[{ total }]] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_bet_order b ${whereClause}`,
    params,
  )
  const [items] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT b.id, b.user_id, b.aggregator_id, b.provider_id, b.provider_txn_id,
            b.round_id, b.bet_type, b.amount, b.currency_code,
            b.original_amount, b.exchange_rate, b.status, b.created_at, b.settled_at,
            (SELECT COALESCE(o.name_override, g.name_en, g.name_zh)
               FROM bg_568win_game g
               LEFT JOIN bg_568win_game_override o
                 ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
              WHERE g.game_id = b.provider_id LIMIT 1) AS game_name,
            (SELECT COALESCE(g.provider, '568Win') FROM bg_568win_game g
              WHERE g.game_id = b.provider_id LIMIT 1) AS provider_name
     FROM bg_bet_order b
     ${whereClause}
     ORDER BY b.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const toIso = (v: unknown) => {
    if (!v) return null
    const d = new Date(v as Date)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  ok(ctx, {
    total: Number(total), page, pageSize,
    stats,
    items: items.map((r) => ({
      id:             r.id,
      userId:         String(r.user_id),
      aggregatorId:   r.aggregator_id  ? String(r.aggregator_id)  : null,
      providerId:     r.provider_id    ? String(r.provider_id)    : null,
      providerTxnId:  r.provider_txn_id ? String(r.provider_txn_id) : null,
      roundId:        r.round_id       ? String(r.round_id)       : null,
      betType:        r.bet_type,
      amount:         Number(r.amount),
      currencyCode:   String(r.currency_code),
      originalAmount: r.original_amount != null ? Number(r.original_amount) : null,
      exchangeRate:   r.exchange_rate   != null ? Number(r.exchange_rate)   : null,
      status:         r.status,
      createdAt:      toIso(r.created_at),
      settledAt:      toIso(r.settled_at),
      gameName:       r.game_name     ? String(r.game_name)     : null,
      providerName:   r.provider_name ? String(r.provider_name) : null,
    })),
  })
})

export default router
