import Router from '@koa/router'
import {
  getSpinConfig,
  listSpinRecords,
  saveSpinConfig,
  type SpinConfig,
} from '../../services/spin.service.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/spin' })

router.get('/config', async (ctx) => {
  ok(ctx, await getSpinConfig(ctx.state.env))
})

router.put('/config', async (ctx) => {
  try {
    const body = ctx.request.body as SpinConfig
    const saved = await saveSpinConfig(ctx.state.env, body)
    ok(ctx, saved)
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '保存失败')
  }
})

router.get('/records', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize ?? 20)))
  const userId = ctx.query.userId ? String(ctx.query.userId) : undefined
  ok(ctx, await listSpinRecords(ctx.state.env, { page, pageSize, userId }))
})

export default router
