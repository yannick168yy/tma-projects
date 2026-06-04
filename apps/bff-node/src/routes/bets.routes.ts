import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import { ok } from '../utils/response.js'

const router = new Router({ prefix: '/bets' })

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
       g.name         AS game_name,
       g.name_zh      AS game_name_zh,
       g.name_vi      AS game_name_vi,
       g.name_id      AS game_name_id,
       g.provider     AS game_provider,
       g.image_url    AS game_image,
       g.image_hq_url AS game_image_hq
     FROM (
       SELECT
         MAX(round_id)                                                         AS round_id,
         MAX(provider_id)                                                      AS game_uuid,
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
      currencyCode: String(r.currency_code),
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
