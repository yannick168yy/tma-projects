import Router from '@koa/router'
import {
  CM_CATEGORIES, CM_PLATFORMS,
  listChannels, saveChannel, deleteChannel,
  listTemplates, saveTemplate, deleteTemplate,
  listRules, saveRule, deleteRule,
  listPostLogs, sendNow, approvePost, markManualPosted, rejectPost,
  aiRewrite, renderTemplateVars,
  type CmButton, type CmCategory, type CmPlatform, type CmStrategy,
} from '../../services/community.service.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/community' })

function validButtons(v: unknown): CmButton[] | null {
  if (v == null) return null
  if (!Array.isArray(v)) return null
  const out: CmButton[] = []
  for (const b of v) {
    if (typeof b?.text !== 'string' || typeof b?.url !== 'string' || !b.text || !b.url) return null
    out.push({ text: b.text, url: b.url })
  }
  return out
}

// ── 渠道 ────────────────────────────────────────────────────────────────────

router.get('/channels', async (ctx) => {
  ok(ctx, { items: await listChannels(ctx.state.env) })
})

router.put('/channels', async (ctx) => {
  const b = (ctx.request.body ?? {}) as Record<string, unknown>
  if (!CM_PLATFORMS.includes(b.platform as CmPlatform)) return fail(ctx, 400, 'platform 无效')
  if (typeof b.name !== 'string' || !b.name.trim()) return fail(ctx, 400, 'name 必填')
  if (typeof b.config !== 'object' || b.config == null) return fail(ctx, 400, 'config 必填')
  const dailyLimit = Number(b.dailyLimit ?? 10)
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100) return fail(ctx, 400, 'dailyLimit 须为 1-100')
  const id = await saveChannel(ctx.state.env, {
    id: b.id ? Number(b.id) : undefined,
    platform: b.platform as CmPlatform,
    name: b.name.trim(),
    config: b.config as Record<string, string>,
    dailyLimit,
    enabled: b.enabled !== false,
  })
  ok(ctx, { id })
})

router.delete('/channels/:id', async (ctx) => {
  await deleteChannel(ctx.state.env, Number(ctx.params.id))
  ok(ctx, { ok: true })
})

// ── 模板 ────────────────────────────────────────────────────────────────────

router.get('/templates', async (ctx) => {
  const category = typeof ctx.query.category === 'string' ? ctx.query.category : undefined
  ok(ctx, { items: await listTemplates(ctx.state.env, category), categories: CM_CATEGORIES })
})

router.put('/templates', async (ctx) => {
  const b = (ctx.request.body ?? {}) as Record<string, unknown>
  if (!CM_CATEGORIES.includes(b.category as CmCategory)) return fail(ctx, 400, 'category 无效')
  if (typeof b.title !== 'string' || !b.title.trim()) return fail(ctx, 400, 'title 必填')
  if (typeof b.body !== 'string' || !b.body.trim()) return fail(ctx, 400, 'body 必填')
  const buttons = validButtons(b.buttons)
  if (b.buttons != null && buttons == null) return fail(ctx, 400, 'buttons 格式须为 [{text,url}]')
  const id = await saveTemplate(ctx.state.env, {
    id: b.id ? Number(b.id) : undefined,
    category: b.category as CmCategory,
    title: b.title.trim(),
    body: b.body,
    imageUrl: typeof b.imageUrl === 'string' && b.imageUrl ? b.imageUrl : null,
    buttons,
    enabled: b.enabled !== false,
    sort: Number.isInteger(Number(b.sort)) ? Number(b.sort) : 0,
  })
  ok(ctx, { id })
})

router.delete('/templates/:id', async (ctx) => {
  await deleteTemplate(ctx.state.env, Number(ctx.params.id))
  ok(ctx, { ok: true })
})

// 模板预览:填充变量(+可选 AI 改写),供后台"预览效果"
router.post('/templates/preview', async (ctx) => {
  const b = (ctx.request.body ?? {}) as Record<string, unknown>
  if (typeof b.body !== 'string' || !b.body.trim()) return fail(ctx, 400, 'body 必填')
  const platform = CM_PLATFORMS.includes(b.platform as CmPlatform) ? (b.platform as CmPlatform) : 'telegram'
  const rendered = renderTemplateVars(b.body)
  const content = b.aiRewrite === true ? await aiRewrite(ctx.state.env, rendered, platform) : rendered
  ok(ctx, { rendered, content, aiApplied: b.aiRewrite === true && content !== rendered })
})

// ── 规则 ────────────────────────────────────────────────────────────────────

router.get('/rules', async (ctx) => {
  ok(ctx, { items: await listRules(ctx.state.env) })
})

router.put('/rules', async (ctx) => {
  const b = (ctx.request.body ?? {}) as Record<string, unknown>
  if (typeof b.name !== 'string' || !b.name.trim()) return fail(ctx, 400, 'name 必填')
  if (!CM_CATEGORIES.includes(b.category as CmCategory)) return fail(ctx, 400, 'category 无效')
  const channelIds = Array.isArray(b.channelIds) ? b.channelIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
  if (!channelIds.length) return fail(ctx, 400, '至少选择一个渠道')
  const slots = Array.isArray(b.slots) ? b.slots.filter((s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)) : []
  if (!slots.length) return fail(ctx, 400, '至少配置一个发送时刻(HH:mm)')
  const strategy: CmStrategy = b.strategy === 'random' ? 'random' : 'sequential'
  const id = await saveRule(ctx.state.env, {
    id: b.id ? Number(b.id) : undefined,
    name: b.name.trim(),
    category: b.category as CmCategory,
    channelIds,
    slots: slots as string[],
    strategy,
    aiRewrite: b.aiRewrite !== false,
    enabled: b.enabled !== false,
  })
  ok(ctx, { id })
})

router.delete('/rules/:id', async (ctx) => {
  await deleteRule(ctx.state.env, Number(ctx.params.id))
  ok(ctx, { ok: true })
})

// ── 发帖记录 / FB 确认队列 ───────────────────────────────────────────────────

router.get('/posts', async (ctx) => {
  const status = typeof ctx.query.status === 'string' ? ctx.query.status : undefined
  const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined
  ok(ctx, { items: await listPostLogs(ctx.state.env, { status, limit }) })
})

// 立即发送(手动帖/测试渠道连通)
router.post('/posts/send-now', async (ctx) => {
  const b = (ctx.request.body ?? {}) as Record<string, unknown>
  const channelIds = Array.isArray(b.channelIds) ? b.channelIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
  if (!channelIds.length) return fail(ctx, 400, '至少选择一个渠道')
  if (typeof b.content !== 'string' || !b.content.trim()) return fail(ctx, 400, 'content 必填')
  const buttons = validButtons(b.buttons)
  const results = await sendNow(ctx.state.env, {
    channelIds,
    content: renderTemplateVars(b.content),
    imageUrl: typeof b.imageUrl === 'string' && b.imageUrl ? b.imageUrl : null,
    buttons,
    aiRewrite: b.aiRewrite === true,
  })
  ok(ctx, { results })
})

router.post('/posts/:id/approve', async (ctx) => {
  try {
    await approvePost(ctx.state.env, Number(ctx.params.id))
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '发送失败')
  }
})

router.post('/posts/:id/mark-manual', async (ctx) => {
  try {
    await markManualPosted(ctx.state.env, Number(ctx.params.id))
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '操作失败')
  }
})

router.post('/posts/:id/reject', async (ctx) => {
  try {
    await rejectPost(ctx.state.env, Number(ctx.params.id))
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '操作失败')
  }
})

export default router
