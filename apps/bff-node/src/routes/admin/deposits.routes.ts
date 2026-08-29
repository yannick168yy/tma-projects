import Router from '@koa/router'
import { listAdminDeposits } from '../../services/admin-store.js'
import { getDeposit } from '../../services/store/index.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/deposits' })

function parseDateQuery(value: unknown): Date | undefined {
  if (!value) return undefined
  const date = new Date(String(value))
  return Number.isFinite(date.getTime()) ? date : undefined
}

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(1000, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const userId = ctx.query.userId ? String(ctx.query.userId) : undefined
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  const currency = ctx.query.currency ? String(ctx.query.currency).toUpperCase() : undefined
  const channel = ctx.query.channel ? String(ctx.query.channel) : undefined
  const dateFrom = parseDateQuery(ctx.query.dateFrom)
  const dateTo = parseDateQuery(ctx.query.dateTo)
  const result = await listAdminDeposits(ctx.state.env, { page, pageSize, userId, status, currency, channel, dateFrom, dateTo })
  ok(ctx, result)
})

router.get('/:orderId', async (ctx) => {
  const order = await getDeposit(ctx.state.redis, ctx.params.orderId)
  if (!order) { fail(ctx, 404, 'Order not found', 404); return }
  ok(ctx, order)
})

export default router
