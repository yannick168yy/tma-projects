import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import { handleUserMessage } from '../services/cs/cs.service.js'
import { getOrCreateConversation, getMessages } from '../services/cs/cs-store.js'

const router = new Router()

// POST /cs/message — 发送消息，获取 AI 回复
router.post('/cs/message', async (ctx) => {
  const userId = Number(ctx.state.userId)
  const { message } = ctx.request.body as { message?: string }
  if (!message?.trim()) {
    fail(ctx, 400, '消息不能为空')
    return
  }
  if (message.length > 2000) {
    fail(ctx, 400, '消息过长')
    return
  }
  const result = await handleUserMessage(ctx.state.env, userId, message.trim())
  ok(ctx, result)
})

// GET /cs/history — 获取历史消息
router.get('/cs/history', async (ctx) => {
  const userId = Number(ctx.state.userId)
  const conversation = await getOrCreateConversation(ctx.state.env, userId)
  const messages = await getMessages(ctx.state.env, conversation.id, 50)
  ok(ctx, { conversation, messages })
})

export default router
