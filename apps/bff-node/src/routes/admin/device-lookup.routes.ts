import Router from '@koa/router'
import { lookupLoginByField } from '../../services/admin-store.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/device-lookup' })

// 反查：GET /admin/device-lookup?field=ip|deviceId|fpVisitor&value=xxx
router.get('/', async (ctx) => {
  const field = String(ctx.query.field ?? '')
  const value = String(ctx.query.value ?? '').trim()
  if (!['ip', 'deviceId', 'fpVisitor'].includes(field)) {
    fail(ctx, 400, 'field must be ip|deviceId|fpVisitor')
    return
  }
  if (!value) {
    fail(ctx, 400, 'value is required')
    return
  }
  const result = await lookupLoginByField(ctx.state.env, field, value)
  ok(ctx, result)
})

export default router
