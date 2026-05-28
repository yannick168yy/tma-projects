import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import {
  listConversations,
  getConversationById,
  getMessages,
  saveMessage,
  updateConversationStatus,
} from '../../services/cs/cs-store.js'

const router = new Router()

// GET /admin/cs/conversations — 会话列表
router.get('/cs/conversations', async (ctx) => {
  const { status, page = '1', pageSize = '20' } = ctx.query as Record<string, string>
  const limit = Math.min(Number(pageSize), 100)
  const offset = (Number(page) - 1) * limit
  const result = await listConversations(ctx.state.env, { status, limit, offset })
  ok(ctx, { ...result, page: Number(page), pageSize: limit })
})

// GET /admin/cs/conversations/:id — 单个会话详情 + 消息
router.get('/cs/conversations/:id', async (ctx) => {
  const id = Number(ctx.params.id)
  const conversation = await getConversationById(ctx.state.env, id)
  if (!conversation) {
    fail(ctx, 404, '会话不存在', 404)
    return
  }
  const messages = await getMessages(ctx.state.env, id, 100)
  ok(ctx, { conversation, messages })
})

// POST /admin/cs/conversations/:id/reply — 人工回复
router.post('/cs/conversations/:id/reply', async (ctx) => {
  const id = Number(ctx.params.id)
  const { message } = ctx.request.body as { message?: string }
  if (!message?.trim()) {
    fail(ctx, 400, '消息不能为空')
    return
  }
  const conversation = await getConversationById(ctx.state.env, id)
  if (!conversation) {
    fail(ctx, 404, '会话不存在', 404)
    return
  }
  // 自动标记为人工接管
  if (conversation.status === 'active') {
    await updateConversationStatus(ctx.state.env, id, 'human_taken', ctx.state.adminId)
  }
  const msg = await saveMessage(ctx.state.env, id, 'admin', message.trim())
  ok(ctx, msg)
})

// POST /admin/cs/conversations/:id/takeover — 接管会话
router.post('/cs/conversations/:id/takeover', async (ctx) => {
  const id = Number(ctx.params.id)
  await updateConversationStatus(ctx.state.env, id, 'human_taken', ctx.state.adminId)
  ok(ctx, { success: true })
})

// POST /admin/cs/conversations/:id/resolve — 结单
router.post('/cs/conversations/:id/resolve', async (ctx) => {
  const id = Number(ctx.params.id)
  await updateConversationStatus(ctx.state.env, id, 'resolved', ctx.state.adminId)
  ok(ctx, { success: true })
})

export default router
