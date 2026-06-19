import Router from '@koa/router'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { runDailyReconciliation } from '../../services/sg-settlement.service.js'
import { ok, fail } from '../../utils/response.js'

const router = new Router({ prefix: '/sg-settlement' })

router.get('/', async (ctx) => {
  const page     = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const offset   = (page - 1) * pageSize

  const pool = getMysqlPool(ctx.state.env)
  const [[{ total }]] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM sg_settlement_report',
  )
  const [items] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT id, DATE_FORMAT(report_date, '%Y-%m-%d') AS reportDate, currency,
            sg_bet_amount AS sgBetAmount, sg_win_amount AS sgWinAmount,
            sg_ggr AS sgGgr, sg_round_count AS sgRoundCount,
            local_bet AS localBet, local_win AS localWin,
            discrepancy_note AS discrepancyNote, reconciled, fetched_at AS fetchedAt
     FROM sg_settlement_report
     ORDER BY report_date DESC, id DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset],
  )

  ok(ctx, { total: Number(total), page, pageSize, items })
})

// 手动触发某日对账
router.post('/reconcile', async (ctx) => {
  const { date } = ctx.request.body as { date?: string }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(ctx, 400, 'date 格式应为 YYYY-MM-DD'); return
  }
  if (!ctx.state.env.SG_BASE_URL || !ctx.state.env.SG_MERCHANT_ID) {
    fail(ctx, 400, 'SG 未配置'); return
  }
  try {
    await runDailyReconciliation(ctx.state.env, date)
    ok(ctx, { date })
  } catch (e) {
    fail(ctx, 502, e instanceof Error ? e.message : 'SG 对账失败', 502)
  }
})

// 标记已核对
router.patch('/:id/reconcile', async (ctx) => {
  const pool = getMysqlPool(ctx.state.env)
  await pool.execute(
    'UPDATE sg_settlement_report SET reconciled = 1 WHERE id = ?',
    [ctx.params.id],
  )
  ok(ctx, { id: ctx.params.id })
})

export default router
