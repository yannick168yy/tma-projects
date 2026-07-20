import Router from '@koa/router'
import { getDashboardStats } from '../../services/admin-store.js'
import { getHomeDashboard } from '../../services/home-dashboard.service.js'
import { fetchBadgeCounts } from '../../services/sse-badges.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/dashboard' })

router.get('/', async (ctx) => {
  const stats = await getDashboardStats(ctx.state.env)
  ok(ctx, stats)
})

// 重设计版首页看板：待办+今日快照+资金+心跳+用户结构
router.get('/v2', async (ctx) => {
  ok(ctx, await getHomeDashboard(ctx.state.env, ctx.state.redis))
})

// HTTP 轮询备用（前端 EventSource 不可用时 fallback）
router.get('/badges', async (ctx) => {
  const badges = await fetchBadgeCounts(ctx.state.env)
  ok(ctx, badges)
})

export default router
