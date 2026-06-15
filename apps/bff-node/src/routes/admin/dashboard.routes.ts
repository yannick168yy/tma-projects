import Router from '@koa/router'
import { getDashboardStats } from '../../services/admin-store.js'
import { fetchBadgeCounts } from '../../services/sse-badges.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/dashboard' })

router.get('/', async (ctx) => {
  const stats = await getDashboardStats(ctx.state.env)
  ok(ctx, stats)
})

// HTTP 轮询备用（前端 EventSource 不可用时 fallback）
router.get('/badges', async (ctx) => {
  const badges = await fetchBadgeCounts(ctx.state.env)
  ok(ctx, badges)
})

export default router
