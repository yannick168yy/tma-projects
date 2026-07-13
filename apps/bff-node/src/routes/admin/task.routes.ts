import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import {
  getTaskConfig, saveTaskConfig,
  adminListSocialConfigs, adminSaveSocialConfig,
  adminListManualReviews, adminReviewManual,
} from '../../services/task.service.js'

const router = new Router({ prefix: '/tasks' })

// 原生任务配置（开关/金额/阈值/打码）；currency 区分留存类每日任务的按币种配置（默认 PHP）
router.get('/config', async (ctx) => {
  const currency = (ctx.query.currency as string) || 'PHP'
  ok(ctx, { currency, config: await getTaskConfig(ctx.state.env, currency) })
})
router.put('/config', async (ctx) => {
  const body = (ctx.request.body ?? {}) as { currency?: string; config?: unknown }
  const currency = body.currency || 'PHP'
  // 兼容旧前端直接 PUT 整个 config 对象（无 currency 包裹）
  const payload = body.config !== undefined ? body.config : ctx.request.body
  ok(ctx, await saveTaskConfig(ctx.state.env, payload, currency))
})

// 社群任务配置（频道标识/验证策略/轮换码/奖励）
router.get('/social', async (ctx) => {
  ok(ctx, await adminListSocialConfigs(ctx.state.env))
})
router.put('/social/:key', async (ctx) => {
  await adminSaveSocialConfig(ctx.state.env, ctx.params.key, (ctx.request.body ?? {}) as Record<string, unknown>)
  ok(ctx, { ok: true })
})

// 截图人工审核队列
router.get('/manual-reviews', async (ctx) => {
  const status = (ctx.query.status as 'pending' | 'approved' | 'rejected') || 'pending'
  ok(ctx, await adminListManualReviews(ctx.state.env, status))
})
router.post('/manual-reviews/:id/review', async (ctx) => {
  const body = (ctx.request.body ?? {}) as { approve?: boolean; note?: string }
  const reviewer = ctx.state.adminUsername || 'admin'
  try {
    await adminReviewManual(ctx.state.env, Number(ctx.params.id), Boolean(body.approve), String(reviewer), body.note ?? '')
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : 'review failed')
  }
})

export default router
