import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import { getCheckinStatus, claimCheckin } from '../services/checkin.service.js'

const router = new Router({ prefix: '/promotions/checkin' })

router.get('/status', async (ctx) => {
  try {
    const status = await getCheckinStatus(ctx.state.env, ctx.state.userId!)
    ok(ctx, status)
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'checkin status failed')
  }
})

router.post('/claim', async (ctx) => {
  try {
    const result = await claimCheckin(ctx.state.env, ctx.state.userId!)
    ok(ctx, result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'checkin claim failed'
    if (msg === 'already claimed') { fail(ctx, 409, msg, 409); return }
    if (msg === 'disabled') { fail(ctx, 403, msg, 403); return }
    fail(ctx, 500, msg)
  }
})

export default router
