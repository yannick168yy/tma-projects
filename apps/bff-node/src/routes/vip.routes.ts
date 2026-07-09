import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import { getUserVipProgress, listVipRewards, claimVipRewards, setUserBirthday, getVipLevelConfig } from '../services/vip.service.js'

const router = new Router({ prefix: '/vip' })

router.get('/levels', async (ctx) => {
  const levels = await getVipLevelConfig(ctx.state.env)
  ok(ctx, { levels })
})

// GET /vip/progress — 需要登录：当前等级 / 成长值 / 下一级 / 本级与下一级权益 / 可领取总额
router.get('/progress', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const currency = (ctx.query.currency as string) || 'PHP'
  const progress = await getUserVipProgress(ctx.state.env, ctx.state.userId, currency)
  ok(ctx, progress)
})

// GET /vip/rewards — 需要登录：VIP 礼金发放记录（待领取 + 历史）
router.get('/rewards', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const rewards = await listVipRewards(ctx.state.env, ctx.state.userId)
  ok(ctx, { rewards })
})

// POST /vip/claim — 需要登录：领取所有待领取 VIP 礼金
router.post('/claim', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const body = (ctx.request.body ?? {}) as { currency?: string }
  const currency = body.currency || 'PHP'
  const result = await claimVipRewards(ctx.state.env, ctx.state.userId, currency)
  if (result.claimed === 0) { fail(ctx, 400, 'No reward to claim'); return }
  ok(ctx, result)
})

// POST /vip/birthday — 需要登录：设置生日（一次性，设置后不可改，用于生日礼金）
router.post('/birthday', async (ctx) => {
  if (!ctx.state.userId) { fail(ctx, 401, 'Unauthorized', 401); return }
  const body = (ctx.request.body ?? {}) as { birthday?: string }
  if (!body.birthday) { fail(ctx, 400, 'birthday required'); return }
  const res = await setUserBirthday(ctx.state.env, ctx.state.userId, body.birthday)
  if (!res.ok) {
    if (res.reason === 'already_set') { fail(ctx, 409, 'Birthday already set'); return }
    if (res.reason === 'invalid') { fail(ctx, 400, 'Invalid birthday'); return }
    fail(ctx, 503, 'Unavailable'); return
  }
  ok(ctx, { ok: true })
})

export default router
