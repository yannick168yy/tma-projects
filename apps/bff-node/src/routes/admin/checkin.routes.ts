import Router from '@koa/router'
import { getCheckinConfig, saveCheckinConfig } from '../../services/checkin.service.js'
import { ok } from '../../utils/response.js'
import { getRate } from '../../services/exchange-rate.service.js'

const router = new Router({ prefix: '/checkin' })

// GET /admin/checkin/config — 每日签到配置（开关/双轨阈值/7日奖励/里程碑）
router.get('/config', async (ctx) => {
  const [config, rate] = await Promise.all([
    getCheckinConfig(ctx.state.env),
    getRate(ctx.state.redis, 'PHP', 'USDT', ctx.state.env),
  ])
  ok(ctx, { ...config, enhancedMinPhp: config.enhancedMinPhp * rate.rate })
})

// PUT /admin/checkin/config — 保存（saveCheckinConfig 内部已归一校验，脏数据回落缺省）
router.put('/config', async (ctx) => {
  const rate = await getRate(ctx.state.redis, 'USDT', 'PHP', ctx.state.env)
  const body = ctx.request.body as { enhancedMinPhp?: number }
  const saved = await saveCheckinConfig(ctx.state.env, {
    ...body,
    enhancedMinPhp: Number(body.enhancedMinPhp ?? 0) * rate.rate,
  })
  const displayRate = await getRate(ctx.state.redis, 'PHP', 'USDT', ctx.state.env)
  ok(ctx, { ...saved, enhancedMinPhp: saved.enhancedMinPhp * displayRate.rate })
})

export default router
