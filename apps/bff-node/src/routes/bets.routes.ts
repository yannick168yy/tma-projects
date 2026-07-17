import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import { ok } from '../utils/response.js'

const router = new Router({ prefix: '/bets' })

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000

function displayCurrencyCode(code: string): string {
  return code.toUpperCase() === 'UCC' ? 'USDT' : code
}

// dateFrom 是 PHT(+8) 日历日, first_at 存 UTC, 故按 PHT 日起点换算成 UTC 实例再比较,
// 否则 PHT 当天 00:00-08:00 的注单会因 UTC 仍属前一日而漏在"今天"之外。
function phtDateStartUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - PHT_OFFSET_MS)
}

router.get('/', async (ctx) => {
  const userId   = ctx.state.userId!
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(50, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset   = (page - 1) * pageSize
  const dateFrom = ctx.query.dateFrom ? String(ctx.query.dateFrom) : undefined

  const pool = getMysqlPool(ctx.state.env)

  // 读加速：查预聚合的 bg_bet_round(每局一行)，索引扫一页(无 GROUP BY/无 filesort)，
  // 游戏名对已分页的 ~20 行做廉价 JOIN 解析。汇总表由 core-node 下注/结算事务维护。
  const where = dateFrom
    ? 'WHERE user_id = ? AND first_at >= ?'
    : 'WHERE user_id = ?'
  const baseParams: unknown[] = dateFrom ? [userId, phtDateStartUtc(dateFrom)] : [userId]

  const [[{ total }]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_bet_round ${where}`,
    baseParams,
  )

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       sub.round_id,
       sub.bet_amount,
       sub.win_amount,
       sub.currency_code,
       sub.created_at,
       COALESCE(wo.name_override, wg.name_en, wg.name_zh, IF(wg.game_id IS NULL, NULL, CONCAT('568Win ', wg.game_id))) AS game_name,
       wg.name_zh AS game_name_zh,
       NULL AS game_name_vi,
       NULL AS game_name_id,
       COALESCE(wg.provider, IF(wg.game_id IS NULL, NULL, '568Win')) AS game_provider,
       COALESCE(wo.image_override, wg.icon_url) AS game_image,
       COALESCE(wo.image_override, wg.icon_url) AS game_image_hq
     FROM (
       SELECT round_id, bet_amount, win_amount, currency_code,
              first_at AS created_at, provider_txn_id, aggregator_id, last_id
       FROM bg_bet_round
       ${where}
       ORDER BY last_id DESC
       LIMIT ? OFFSET ?
     ) sub
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
     ORDER BY sub.last_id DESC`,
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
