import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { getDashboardStats } from '../../services/admin-store.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/dashboard' })

router.get('/', async (ctx) => {
  const stats = await getDashboardStats(ctx.state.env)
  ok(ctx, stats)
})

router.get('/badges', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, { manualWithdrawals: 0, pendingCs: 0 })
    return
  }
  const db = getMysqlPool(ctx.state.env)
  const [[wRow], [csRow]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM bg_withdraw_order WHERE status = 'pending' AND review_verdict = 'manual'`,
    ),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM cs_conversation WHERE status = 'human_taken'`,
    ),
  ])
  ok(ctx, {
    manualWithdrawals: Number(wRow[0]?.cnt ?? 0),
    pendingCs: Number(csRow[0]?.cnt ?? 0),
  })
})

export default router
