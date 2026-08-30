import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import { getCheckinStatus, claimCheckin } from '../services/checkin.service.js'
import { riskAllowed } from '../utils/risk-guard.js'

const router = new Router({ prefix: '/promotions/checkin' })

router.get('/status', async (ctx) => {
  try {
    const currency = String(ctx.query.currency ?? 'PHP').toUpperCase()
    const status = await getCheckinStatus(ctx.state.env, ctx.state.userId!, currency, ctx.state.redis)
    ok(ctx, status)
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'checkin status failed')
  }
})

router.post('/claim', async (ctx) => {
  try {
    if (!(await riskAllowed(ctx, 'promo_claim'))) return
    const currency = String((ctx.request.body as { currency?: string } | undefined)?.currency ?? 'PHP').toUpperCase()
    const result = await claimCheckin(ctx.state.env, ctx.state.userId!, currency, ctx.state.redis)
    ok(ctx, result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'checkin claim failed'
    if (msg === 'already claimed') { fail(ctx, 409, msg, 409); return }
    if (msg === 'disabled') { fail(ctx, 403, msg, 403); return }
    fail(ctx, 500, msg)
  }
})

export default router
