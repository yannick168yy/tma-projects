import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getTurnoverProgress } from '../services/turnover.service.js'
import { ok } from '../utils/response.js'

const router = new Router({ prefix: '/turnover' })

router.get('/', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, { canWithdraw: true, totalRemaining: 0, depositRemaining: 0, lockedBonus: 0, hasDeposit: true, requirements: [] })
    return
  }
  const pool = getMysqlPool(ctx.state.env)
  const currency = ctx.query.currency ? String(ctx.query.currency) : undefined
  const [progress, [[depRow]]] = await Promise.all([
    getTurnoverProgress(pool, ctx.state.userId!, currency),
    pool.query<RowDataPacket[]>(
      `SELECT EXISTS(SELECT 1 FROM bg_deposit_order WHERE user_id = ? AND status = 'paid') AS has_dep`,
      [ctx.state.userId!],
    ),
  ])
  ok(ctx, { ...progress, hasDeposit: Number(depRow?.has_dep ?? 0) === 1 })
})

export default router
