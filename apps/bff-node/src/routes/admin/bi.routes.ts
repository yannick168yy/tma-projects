import Router from '@koa/router'
import { getBiOverview, getBiTrends } from '../../services/bi.service.js'
import { ok, fail } from '../../utils/response.js'

const router = new Router({ prefix: '/bi' })

router.get('/overview', async (ctx) => {
  const data = await getBiOverview(ctx.state.env, ctx.state.redis)
  ok(ctx, data)
})

router.get('/trends', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 7), 365)
  const granularity = ['day', 'week', 'month'].includes(String(ctx.query.granularity))
    ? (String(ctx.query.granularity) as 'day' | 'week' | 'month')
    : 'day'
  const currency = ctx.query.currency ? String(ctx.query.currency) : 'ALL'
  if (!/^[A-Z]{2,10}$/.test(currency) && currency !== 'ALL') {
    fail(ctx, 400, 'invalid currency')
    return
  }
  const data = await getBiTrends(ctx.state.env, ctx.state.redis, { days, granularity, currency })
  ok(ctx, data)
})

export default router
