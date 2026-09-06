import Router from '@koa/router'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { ok } from '../../utils/response.js'
import { DEFAULT_AGGREGATOR } from '../../lib/aggregators.js'

const router = new Router({ prefix: '/bet-orders' })

function utc8DayStartUtc(date: string): string {
  return new Date(`${date}T00:00:00+08:00`).toISOString().slice(0, 19).replace('T', ' ')
}

function utc8NextDayStartUtc(date: string): string {
  return new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 86400000).toISOString().slice(0, 19).replace('T', ' ')
}

function pushRoundIdFilter(where: string[], params: unknown[], roundId: string) {
  where.push('(b.round_id = ? OR (b.round_id IS NULL AND b.provider_txn_id = ?))')
  params.push(roundId, roundId)
}

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
  const roundId  = ctx.query.roundId  ? String(ctx.query.roundId).trim() : undefined

  const pool = getMysqlPool(ctx.state.env)

  // ── 按局视图 ────────────────────────────────────────────────────────────────
  if (view === 'round') {
    const roundWhere: string[] = []
    const roundParams: unknown[] = []
    if (userId)   { roundWhere.push('br.user_id = ?');  roundParams.push(userId) }
    if (roundId)  { roundWhere.push('br.round_id = ?'); roundParams.push(roundId) }
    if (dateFrom) { roundWhere.push('br.first_at >= ?'); roundParams.push(utc8DayStartUtc(dateFrom)) }
    if (dateTo)   { roundWhere.push('br.first_at < ?');  roundParams.push(utc8NextDayStartUtc(dateTo)) }
    const roundWhereClause = roundWhere.length ? 'WHERE ' + roundWhere.join(' AND ') : ''
    const sortBy = ctx.query.sortBy === 'betAmount' || ctx.query.sortBy === 'ggr' ? String(ctx.query.sortBy) : 'time'
    const sortDir = ctx.query.sortOrder === 'asc' ? 'ASC' : 'DESC'
    const orderBy = sortBy === 'betAmount'
      ? `br.bet_amount ${sortDir}, br.last_id DESC`
      : sortBy === 'ggr'
        ? `(br.bet_amount - br.win_amount) ${sortDir}, br.last_id DESC`
        : 'br.last_id DESC'

    const [[roundStats]] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
      `SELECT COALESCE(SUM(br.bet_amount), 0) AS totalBet,
              COALESCE(SUM(br.win_amount), 0) AS totalWin,
              COUNT(*) AS roundCount
       FROM bg_bet_round br ${roundWhereClause}`,
      roundParams,
    )
    const stats = { totalBet: Number(roundStats.totalBet), totalWin: Number(roundStats.totalWin), roundCount: Number(roundStats.roundCount) }

    const [items] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
      `SELECT p.round_id, p.user_id, p.currency_code,
              p.bet_amount, p.win_amount, p.first_at, p.updated_at,
              COALESCE(o.name_override, g.name_en, g.name_zh) AS game_name,
              COALESCE(g.provider, '568Win') AS provider_name
       FROM (
         SELECT br.round_id, br.user_id, br.currency_code, br.provider_txn_id,
                br.bet_amount, br.win_amount, br.first_at, br.updated_at, br.aggregator_id, br.last_id
         FROM bg_bet_round br
         ${roundWhereClause}
         ORDER BY ${orderBy} LIMIT ? OFFSET ?
       ) p
       LEFT JOIN bg_568win_wallet_txn wt
         ON p.aggregator_id = '${DEFAULT_AGGREGATOR}'
        AND wt.transfer_code = CASE
          WHEN LOCATE(':', p.provider_txn_id) > 0 THEN SUBSTRING_INDEX(p.provider_txn_id, ':', 1)
          ELSE p.provider_txn_id
        END
        AND (
          LOCATE(':', p.provider_txn_id) = 0
          OR wt.transaction_id = SUBSTRING_INDEX(p.provider_txn_id, ':', -1)
        )
       LEFT JOIN bg_568win_game g
         ON g.game_provider_id = wt.gpid
        AND g.game_id = CAST(wt.provider_id AS UNSIGNED)
       LEFT JOIN bg_568win_game_override o
         ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
       ORDER BY ${orderBy.replaceAll('br.', 'p.')}`,
      [...roundParams, pageSize, offset],
    )
    const toIso = (v: unknown) => {
      if (!v) return null
      const d = new Date(v as Date)
      return isNaN(d.getTime()) ? null : d.toISOString()
    }
    ok(ctx, {
      total: stats.roundCount, page, pageSize,
      stats,
      items: items.map((r) => ({
        roundId:      String(r.round_id),
        userId:       String(r.user_id),
        currencyCode: String(r.currency_code),
        betAmount:    Number(r.bet_amount),
        winAmount:    Number(r.win_amount),
        cancelled:    false,
        gameName:     r.game_name     ? String(r.game_name)     : null,
        providerName: r.provider_name ? String(r.provider_name) : null,
        betTime:      toIso(r.first_at),
        winTime:      toIso(r.updated_at),
      })),
    })
    return
  }

  // stats 始终只按 userId/日期过滤，明细视图使用原始注单表
  const statsWhere: string[] = []
  const statsParams: unknown[] = []
  if (userId)   { statsWhere.push('b.user_id = ?');     statsParams.push(userId) }
  if (roundId)  { pushRoundIdFilter(statsWhere, statsParams, roundId) }
  if (dateFrom) { statsWhere.push('b.created_at >= ?'); statsParams.push(utc8DayStartUtc(dateFrom)) }
  if (dateTo)   { statsWhere.push('b.created_at < ?');  statsParams.push(utc8NextDayStartUtc(dateTo)) }
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

  // ── 明细视图 ────────────────────────────────────────────────────────────────
  const where: string[] = []
  const params: unknown[] = []

  if (userId)   { where.push('b.user_id = ?');     params.push(userId) }
  if (roundId)  { pushRoundIdFilter(where, params, roundId) }
  if (status)   { where.push('b.status = ?');      params.push(status) }
  if (betType)  { where.push('b.bet_type = ?');    params.push(betType) }
  if (dateFrom) { where.push('b.created_at >= ?'); params.push(utc8DayStartUtc(dateFrom)) }
  if (dateTo)   { where.push('b.created_at < ?');  params.push(utc8NextDayStartUtc(dateTo)) }

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
              WHERE g.game_id = b.provider_id
                AND g.game_provider_id = COALESCE(
                  (SELECT wt.gpid FROM bg_568win_wallet_txn wt
                    WHERE wt.user_id = b.user_id AND wt.provider_id = b.provider_id AND wt.gpid IS NOT NULL
                    ORDER BY (wt.round_id <=> b.round_id) DESC, wt.id DESC LIMIT 1),
                  g.game_provider_id)
              LIMIT 1) AS game_name,
            (SELECT COALESCE(g.provider, '568Win') FROM bg_568win_game g
              WHERE g.game_id = b.provider_id
                AND g.game_provider_id = COALESCE(
                  (SELECT wt.gpid FROM bg_568win_wallet_txn wt
                    WHERE wt.user_id = b.user_id AND wt.provider_id = b.provider_id AND wt.gpid IS NOT NULL
                    ORDER BY (wt.round_id <=> b.round_id) DESC, wt.id DESC LIMIT 1),
                  g.game_provider_id)
              LIMIT 1) AS provider_name
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
