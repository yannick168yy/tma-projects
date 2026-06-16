import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import {
  getLevelRates,
  getAllLevelRates,
  getFeaturedGames,
  getUserRebateSummary,
  getUserLevelProgress,
  claimRebate,
  todayPHT,
  yesterdayPHT,
} from '../services/rebate.service.js'

const router = new Router({ prefix: '/rebate' })

// GET /rebate/config — 公开：LV1 费率 + 全等级费率矩阵(分级卡片) + 精选游戏（登录用户用 /rebate/progress 取本级与进度）
router.get('/config', async (ctx) => {
  const [config, levels, featured] = await Promise.all([
    getLevelRates(ctx.state.env, 1),
    getAllLevelRates(ctx.state.env),
    getFeaturedGames(ctx.state.env),
  ])
  const featuredByTier: Record<string, typeof featured> = {}
  for (const g of featured) {
    if (!featuredByTier[g.tier]) featuredByTier[g.tier] = []
    featuredByTier[g.tier].push(g)
  }
  ok(ctx, { config, levels, featured: featuredByTier })
})

// GET /rebate/progress — 需要登录：用户总流水 / 当前等级 / 下一级阈值 / 本级费率 / 可领取总额
router.get('/progress', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const currency = (ctx.query.currency as string) || 'PHP'
  const progress = await getUserLevelProgress(ctx.state.env, ctx.state.userId, currency)
  ok(ctx, progress)
})

// POST /rebate/claim — 需要登录：领取所有已结算待领取的洗码
router.post('/claim', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const body = (ctx.request.body ?? {}) as { currency?: string }
  const currency = body.currency || 'PHP'
  const result = await claimRebate(ctx.state.env, ctx.state.userId, currency)
  if (result.claimed === 0) { fail(ctx, 400, 'No rebate to claim'); return }
  ok(ctx, result)
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
