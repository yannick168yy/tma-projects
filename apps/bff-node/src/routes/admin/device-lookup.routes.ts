import Router from '@koa/router'
import { lookupLoginByValue } from '../../services/admin-store.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/device-lookup' })

// 反查：GET /admin/device-lookup?value=xxx —— 一次输入同时匹配 IP/设备ID/指纹/账号
router.get('/', async (ctx) => {
  const value = String(ctx.query.value ?? '').trim()
  if (!value) {
    fail(ctx, 400, 'value is required')
    return
  }
  const result = await lookupLoginByValue(ctx.state.env, value)
  ok(ctx, result)
})

export default router
