import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import {
  getRebateConfig,
  getFeaturedGames,
  getUserRebateSummary,
  todayPHT,
  yesterdayPHT,
} from '../services/rebate.service.js'

const router = new Router({ prefix: '/rebate' })

// summary 路由需要登录（userId 由 optionalAuth 注入后在 handler 检查）

// GET /rebate/config — 公开：各大类洗码费率 + 精选游戏
router.get('/config', async (ctx) => {
  const [config, featured] = await Promise.all([
    getRebateConfig(ctx.state.env),
    getFeaturedGames(ctx.state.env),
  ])
  const featuredByTier: Record<string, typeof featured> = {}
  for (const g of featured) {
    if (!featuredByTier[g.tier]) featuredByTier[g.tier] = []
    featuredByTier[g.tier].push(g)
  }
  ok(ctx, { config, featured: featuredByTier })
})

// GET /rebate/summary?date=today|yesterday|YYYY-MM-DD — 需要登录
router.get('/summary', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const userId = ctx.state.userId
  const dateParam = (ctx.query.date as string) || 'today'
  const currency = (ctx.query.currency as string) || 'PHP'

  let phtDate: string
  if (dateParam === 'today') {
    phtDate = todayPHT()
  } else if (dateParam === 'yesterday') {
    phtDate = yesterdayPHT()
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    phtDate = dateParam
  } else {
    fail(ctx, 400, 'Invalid date parameter')
    return
  }

  const summary = await getUserRebateSummary(ctx.state.env, userId, phtDate, currency)
  ok(ctx, summary)
})

export default router
