import Router from '@koa/router'
import { listAdminDeposits } from '../../services/admin-store.js'
import { getDeposit } from '../../services/store/index.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/deposits' })

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const userId = ctx.query.userId ? String(ctx.query.userId) : undefined
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  const result = await listAdminDeposits(ctx.state.env, { page, pageSize, userId, status })
  ok(ctx, result)
})

router.get('/:orderId', async (ctx) => {
  const order = await getDeposit(ctx.state.redis, ctx.params.orderId)
  if (!order) { fail(ctx, 404, 'Order not found', 404); return }
  ok(ctx, order)
})

export default router
