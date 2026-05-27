import Router from '@koa/router'
import { getDashboardStats } from '../../services/admin-store.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/dashboard' })

router.get('/', async (ctx) => {
  const stats = await getDashboardStats(ctx.state.env)
  ok(ctx, stats)
})

export default router
