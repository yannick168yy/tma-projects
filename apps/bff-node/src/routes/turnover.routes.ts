import Router from '@koa/router'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getTurnoverProgress } from '../services/turnover.service.js'
import { hasRealDepositForWithdraw } from '../services/withdraw-eligibility.service.js'
import { ok } from '../utils/response.js'

const router = new Router({ prefix: '/turnover' })

router.get('/', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, { canWithdraw: true, totalRemaining: 0, depositRemaining: 0, lockedBonus: 0, hasDeposit: true, requirements: [] })
    return
  }
  const pool = getMysqlPool(ctx.state.env)
  const currency = ctx.query.currency ? String(ctx.query.currency) : undefined
  const [progress, hasDeposit] = await Promise.all([
    getTurnoverProgress(pool, ctx.state.userId!, currency),
    hasRealDepositForWithdraw(pool, ctx.state.userId!),
  ])
  ok(ctx, { ...progress, hasDeposit })
})

export default router
