import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import { getUserVipProgress, listVipRewards, claimVipRewards, getVipLevelConfig } from '../services/vip.service.js'

const router = new Router({ prefix: '/vip' })

router.get('/levels', async (ctx) => {
  const currency = (ctx.query.currency as string) || 'PHP'
  const levels = await getVipLevelConfig(ctx.state.env, currency)
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

// 生日不再接受用户手输：只在 KYC 通过时从证件信息同步（见 vip.service.ensureBirthdayFromKyc）

export default router
