import Router from '@koa/router'
import { listAuditLog } from '../../services/admin-store.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/audit-log' })

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 50)))
  const items = await listAuditLog(ctx.state.env, page, pageSize)
  ok(ctx, { items, page })
})

export default router
