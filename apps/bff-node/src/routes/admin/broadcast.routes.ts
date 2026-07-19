import Router from '@koa/router'
import {
  audienceCount, cancelBroadcast, deleteBroadcast, getBroadcast, listBroadcasts, listFails,
  runBroadcastTick, saveBroadcast, startBroadcast, storeBroadcastImage, testSend,
  type TbButton,
} from '../../services/broadcast.service.js'
import { requireRole } from '../../middleware/require-role.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/broadcast' })

function validButtons(v: unknown): TbButton[] | null {
  if (v == null) return null
  if (!Array.isArray(v)) return null
  const out: TbButton[] = []
  for (const b of v) {
    if (typeof b?.text !== 'string' || typeof b?.url !== 'string' || !b.text || !b.url) return null
    const kind = b.kind === 'webapp' ? 'webapp' : 'url'
    // web_app 按钮 Telegram 强制 https
    if (kind === 'webapp' && !/^https:\/\//.test(b.url)) return null
    out.push({ text: b.text, kind, url: b.url })
  }
  return out
}

router.get('/', async (ctx) => {
  ok(ctx, { items: await listBroadcasts(ctx.state.env) })
})

router.get('/audience', async (ctx) => {
  ok(ctx, { count: await audienceCount(ctx.state.env) })
})

router.put('/', async (ctx) => {
  const b = (ctx.request.body ?? {}) as Record<string, unknown>
  if (typeof b.title !== 'string' || !b.title.trim()) return fail(ctx, 400, 'title 必填')
  if (typeof b.content !== 'string' || !b.content.trim()) return fail(ctx, 400, 'content 必填')
  if (b.content.length > 1024) return fail(ctx, 400, '文案不能超过 1024 字符(Telegram 图片 caption 上限)')
  const buttons = validButtons(b.buttons)
  if (b.buttons != null && buttons == null) return fail(ctx, 400, 'buttons 格式须为 [{text,kind,url}],webapp 按钮链接须为 https')
  const imageKey = typeof b.imageKey === 'string' && b.imageKey ? b.imageKey : null
  if (imageKey && !imageKey.startsWith('home/broadcast/')) return fail(ctx, 400, 'imageKey 无效')
  try {
    const id = await saveBroadcast(ctx.state.env, {
      id: b.id ? Number(b.id) : undefined,
      title: b.title.trim(),
      content: b.content,
      imageKey,
      buttons,
      createdBy: ctx.state.adminUsername,
    })
    ok(ctx, { id })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '保存失败')
  }
})

router.delete('/:id', async (ctx) => {
  try {
    await deleteBroadcast(ctx.state.env, Number(ctx.params.id))
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '删除失败')
  }
})

router.post('/upload', async (ctx) => {
  const b = (ctx.request.body ?? {}) as { imageData?: unknown }
  if (typeof b.imageData !== 'string' || !b.imageData) return fail(ctx, 400, 'imageData 必填')
  try {
    ok(ctx, await storeBroadcastImage(ctx.state.env, b.imageData))
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '上传失败')
  }
})

// 测试发送:发给指定 tg id(通常是运营自己),验证文案/图/按钮效果
router.post('/:id/test', async (ctx) => {
  const b = (ctx.request.body ?? {}) as { tgId?: unknown }
  const tgId = typeof b.tgId === 'string' ? b.tgId.trim() : ''
  if (!/^\d{5,15}$/.test(tgId)) return fail(ctx, 400, 'tgId 须为数字 Telegram 用户 ID')
  try {
    await testSend(ctx.state.env, Number(ctx.params.id), tgId)
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '发送失败')
  }
})

router.post('/:id/send', requireRole('super_admin', '仅超级管理员可开始群发'), async (ctx) => {
  try {
    const r = await startBroadcast(ctx.state.env, Number(ctx.params.id))
    // 立即启动一轮,不等 30s tick;tick 内有 Redis 锁,不会与定时轮重入
    void runBroadcastTick(ctx.state.env, ctx.state.redis)
    ok(ctx, r)
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '启动失败')
  }
})

router.post('/:id/cancel', requireRole('super_admin', '仅超级管理员可取消群发'), async (ctx) => {
  try {
    await cancelBroadcast(ctx.state.env, Number(ctx.params.id))
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '取消失败')
  }
})

router.get('/:id/fails', async (ctx) => {
  const b = await getBroadcast(ctx.state.env, Number(ctx.params.id))
  if (!b) return fail(ctx, 404, '任务不存在')
  ok(ctx, { items: await listFails(ctx.state.env, b.id) })
})

export default router
