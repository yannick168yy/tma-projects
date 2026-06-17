import Router from '@koa/router'
import { drawSpin, getSpinStatus } from '../services/spin.service.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/spin' })

router.get('/status', async (ctx) => {
  const userId = ctx.state.userId
  if (!userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const ruleId = ctx.query.ruleId ? Number(ctx.query.ruleId) : undefined
  const status = await getSpinStatus(ctx.state.env, userId, ctx.state.redis, ruleId)
  ok(ctx, status)
})

router.post('/draw', async (ctx) => {
  const userId = ctx.state.userId
  if (!userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  try {
    const body = (ctx.request.body ?? {}) as { ruleId?: number }
    const ruleId = body.ruleId ? Number(body.ruleId) : undefined
    const result = await drawSpin(ctx.state.env, userId, ruleId, ctx.state.traceId)
    ok(ctx, result)
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : 'Spin failed')
  }
})

export default router
