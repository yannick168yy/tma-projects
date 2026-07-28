import Router from '@koa/router'
import { z } from 'zod'
import { ANNOUNCEMENT_PLACEMENTS, listAnnouncements, upsertAnnouncement } from '../../services/announcement.service.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router()

// GET /admin/announcements — 列出全部展示位配置（含未启用）
router.get('/announcements', async (ctx) => {
  ok(ctx, { items: await listAnnouncements(ctx.state.env) })
})

const upsertSchema = z.object({
  placement: z.enum(ANNOUNCEMENT_PLACEMENTS),
  enabled: z.boolean(),
  contents: z.object({
    en: z.string().default(''),
    zh: z.string().default(''),
    id: z.string().default(''),
    vi: z.string().default(''),
  }),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
})

// POST /admin/announcements — 按展示位保存
router.post('/announcements', async (ctx) => {
  const parsed = upsertSchema.safeParse(ctx.request.body)
  if (!parsed.success) {
    fail(ctx, 400, '公告配置参数无效')
    return
  }
  await upsertAnnouncement(ctx.state.env, parsed.data)
  ok(ctx, { ok: true })
})

export default router
