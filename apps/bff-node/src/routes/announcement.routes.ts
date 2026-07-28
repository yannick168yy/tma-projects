import Router from '@koa/router'
import { getPublicAnnouncements } from '../services/announcement.service.js'
import { ok } from '../utils/response.js'

const router = new Router()

// GET /api/v1/announcements — 前台公开读取当前生效的站内公告
router.get('/announcements', async (ctx) => {
  ok(ctx, await getPublicAnnouncements(ctx.state.env))
})

export default router
