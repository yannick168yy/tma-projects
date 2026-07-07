import Router from '@koa/router'
import { getCheckinConfig, saveCheckinConfig } from '../../services/checkin.service.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/checkin' })

// GET /admin/checkin/config — 每日签到配置（开关/双轨阈值/7日奖励/里程碑）
router.get('/config', async (ctx) => {
  ok(ctx, await getCheckinConfig(ctx.state.env))
})

// PUT /admin/checkin/config — 保存（saveCheckinConfig 内部已归一校验，脏数据回落缺省）
router.put('/config', async (ctx) => {
  const saved = await saveCheckinConfig(ctx.state.env, ctx.request.body)
  ok(ctx, saved)
})

export default router
