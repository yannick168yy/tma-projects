import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import { getTaskCenter, claimTask, claimSocialTask } from '../services/task.service.js'
import { riskAllowed } from '../utils/risk-guard.js'

const router = new Router({ prefix: '/tasks' })

// GET /tasks — 任务中心（新手/每日/成就/社群 四区卡片）
router.get('/', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  try {
    ok(ctx, await getTaskCenter(ctx.state.env, ctx.state.userId))
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'task center failed')
  }
})

// POST /tasks/:id/claim — 领取原生任务
router.post('/:id/claim', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  try {
    if (!(await riskAllowed(ctx, 'promo_claim'))) return
    const result = await claimTask(ctx.state.env, ctx.state.userId, ctx.params.id)
    ok(ctx, result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'claim failed'
    if (msg === 'already claimed') { fail(ctx, 409, msg, 409); return }
    if (msg === 'not eligible') { fail(ctx, 403, msg, 403); return }
    if (msg === 'disabled' || msg === 'unknown task') { fail(ctx, 404, msg, 404); return }
    fail(ctx, 500, msg)
  }
})

// POST /tasks/social/:key/claim — 领取社群任务（body: code / screenshotUrl）
router.post('/social/:key/claim', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const body = (ctx.request.body ?? {}) as { code?: string; screenshotUrl?: string }
  try {
    if (!(await riskAllowed(ctx, 'promo_claim'))) return
    const result = await claimSocialTask(ctx.state.env, ctx.state.userId, ctx.params.key, {
      code: body.code, screenshotUrl: body.screenshotUrl, ip: ctx.ip,
    })
    ok(ctx, result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'claim failed'
    if (msg === 'already claimed') { fail(ctx, 409, msg, 409); return }
    if (msg === 'need_bind_telegram') { fail(ctx, 428, msg, 428); return } // 前置需绑定 TG
    if (msg === 'not_member') { fail(ctx, 403, msg, 403); return }
    if (msg === 'bad_code') { fail(ctx, 400, msg, 400); return }
    if (msg === 'unknown task') { fail(ctx, 404, msg, 404); return }
    fail(ctx, 500, msg)
  }
})

export default router
