import Router from '@koa/router'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getTurnoverProgress } from '../services/turnover.service.js'
import { ok } from '../utils/response.js'

const router = new Router({ prefix: '/turnover' })

router.get('/', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, { canWithdraw: true, totalRemaining: 0, requirements: [] })
    return
  }
  const progress = await getTurnoverProgress(getMysqlPool(ctx.state.env), ctx.state.userId!)
  ok(ctx, progress)
})

export default router
