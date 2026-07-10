import Router from '@koa/router'
import { drawSpin, getSpinStatus, getPublicSpinStatus, listSpinRecords } from '../services/spin.service.js'
import { fail, ok } from '../utils/response.js'
import { riskAllowed } from '../utils/risk-guard.js'

const router = new Router({ prefix: '/spin' })

router.get('/status', async (ctx) => {
  const userId = ctx.state.userId
  const ruleId = ctx.query.ruleId ? Number(ctx.query.ruleId) : undefined
  const status = userId
    ? await getSpinStatus(ctx.state.env, userId, ctx.state.redis, ruleId)
    : await getPublicSpinStatus(ctx.state.env, ctx.state.redis, ruleId)
  ok(ctx, status)
})

router.post('/draw', async (ctx) => {
  const userId = ctx.state.userId
  if (!userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  try {
    if (!(await riskAllowed(ctx, 'promo_claim'))) return
    const body = (ctx.request.body ?? {}) as { ruleId?: number }
    const ruleId = body.ruleId ? Number(body.ruleId) : undefined
    const result = await drawSpin(ctx.state.env, userId, ruleId, ctx.state.traceId)
    ok(ctx, result)
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : 'Spin failed')
  }
})

router.get('/records', async (ctx) => {
  const userId = ctx.state.userId
  if (!userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(50, Math.max(1, Number(ctx.query.pageSize ?? 20)))
  ok(ctx, await listSpinRecords(ctx.state.env, { page, pageSize, userId }))
})

export default router
