import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import { ok } from '../utils/response.js'

const router = new Router({ prefix: '/bets' })

function displayCurrencyCode(code: string): string {
  return code.toUpperCase() === 'UCC' ? 'USDT' : code
}

router.get('/', async (ctx) => {
  const userId   = ctx.state.userId!
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(50, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset   = (page - 1) * pageSize
  const dateFrom = ctx.query.dateFrom ? String(ctx.query.dateFrom) : undefined

  const pool = getMysqlPool(ctx.state.env)

  const where = dateFrom
    ? 'WHERE user_id = ? AND created_at >= ?'
    : 'WHERE user_id = ?'
  const baseParams: unknown[] = dateFrom ? [userId, `${dateFrom} 00:00:00`] : [userId]

  const [[{ total }]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (
       SELECT 1 FROM bg_bet_order ${where} GROUP BY IFNULL(round_id, id)
     ) t`,
    baseParams,
  )

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       sub.round_id,
       sub.bet_amount,
       sub.win_amount,
       sub.currency_code,
       sub.created_at,
       sub.max_id,
       COALESCE(g.name, wo.name_override, wg.name_en, wg.name_zh, IF(wg.game_id IS NULL, NULL, CONCAT('568Win ', wg.game_id))) AS game_name,
       COALESCE(g.name_zh, wg.name_zh) AS game_name_zh,
       g.name_vi AS game_name_vi,
       g.name_id AS game_name_id,
       COALESCE(g.provider, wg.provider, IF(wg.game_id IS NULL, NULL, '568Win')) AS game_provider,
       COALESCE(g.image_url, wo.image_override, wg.icon_url) AS game_image,
       COALESCE(g.image_hq_url, wo.image_override, wg.icon_url) AS game_image_hq
     FROM (
       SELECT
         MAX(round_id)                                                         AS round_id,
         MAX(provider_id)                                                      AS game_uuid,
         MAX(provider_txn_id)                                                  AS provider_txn_id,
         MAX(aggregator_id)                                                    AS aggregator_id,
         SUM(CASE WHEN bet_type = 'bet'             THEN amount ELSE 0 END)   AS bet_amount,
         SUM(CASE WHEN bet_type IN ('win','refund') THEN amount ELSE 0 END)   AS win_amount,
         MAX(currency_code) AS currency_code,
         MIN(created_at)    AS created_at,
         MAX(id)            AS max_id
       FROM bg_bet_order
       ${where}
       GROUP BY IFNULL(round_id, id)
       ORDER BY MAX(id) DESC
       LIMIT ? OFFSET ?
     ) sub
     LEFT JOIN sg_games g ON g.uuid = sub.game_uuid
     LEFT JOIN bg_568win_wallet_txn wt
       ON sub.aggregator_id = '568win'
      AND wt.transfer_code = CASE
        WHEN LOCATE(':', sub.provider_txn_id) > 0 THEN SUBSTRING_INDEX(sub.provider_txn_id, ':', 1)
        ELSE sub.provider_txn_id
      END
      AND (
        LOCATE(':', sub.provider_txn_id) = 0
        OR wt.transaction_id = SUBSTRING_INDEX(sub.provider_txn_id, ':', -1)
      )
     LEFT JOIN bg_568win_game wg
       ON wg.game_provider_id = wt.gpid
      AND wg.game_id = CAST(wt.provider_id AS UNSIGNED)
     LEFT JOIN bg_568win_game_override wo
       ON wo.game_provider_id = wg.game_provider_id
      AND wo.game_id = wg.game_id
     ORDER BY sub.max_id DESC`,
    [...baseParams, pageSize, offset],
  )

  function toIso(v: unknown): string | null {
    const d = new Date(v as Date)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  ok(ctx, {
    total: Number(total),
    page,
    pageSize,
    items: rows.map((r) => ({
      roundId:      r.round_id      ? String(r.round_id)      : null,
      betAmount:    Number(r.bet_amount),
      winAmount:    Number(r.win_amount),
      currencyCode: displayCurrencyCode(String(r.currency_code)),
      createdAt:    toIso(r.created_at),
      gameName:     r.game_name     ? String(r.game_name)     : null,
      gameNameZh:   r.game_name_zh  ? String(r.game_name_zh)  : null,
      gameNameVi:   r.game_name_vi  ? String(r.game_name_vi)  : null,
      gameNameId:   r.game_name_id  ? String(r.game_name_id)  : null,
      gameProvider: r.game_provider ? String(r.game_provider) : null,
      gameImage:    r.game_image    ? String(r.game_image)    : null,
      gameImageHq:  r.game_image_hq ? String(r.game_image_hq) : null,
    })),
  })
})

export default router
