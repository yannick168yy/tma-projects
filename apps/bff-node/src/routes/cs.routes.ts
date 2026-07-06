import Router from '@koa/router'
import type { Context } from 'koa'
import type { Redis } from 'ioredis'
import { ok, fail } from '../utils/response.js'
import { handleUserMessage } from '../services/cs/cs.service.js'
import { getOrCreateConversation, getMessages } from '../services/cs/cs-store.js'
import { CS_INTENTS, CS_WELCOME_SETTING_KEY, DEFAULT_WELCOME } from '../services/cs/cs-intents.js'
import { queryRecentOrders, type OrderKind } from '../services/cs/cs-orders.js'
import { getAdminSetting } from '../services/admin-store.js'

const GUEST_HOURLY_LIMIT = 20
const USER_MINUTE_LIMIT = 20

function getClientIp(ctx: Context): string {
  const forwarded = ctx.get('X-Forwarded-For')
  const ip = forwarded ? forwarded.split(',')[0].trim() : ctx.ip
  return ip.replace(/[^a-zA-Z0-9.:]/g, '').slice(0, 64) || 'unknown'
}

async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSecs: number,
): Promise<{ limited: boolean; retryAfter: number }> {
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, windowSecs)
  if (count > limit) {
    const ttl = await redis.ttl(key)
    return { limited: true, retryAfter: Math.max(ttl, 1) }
  }
  return { limited: false, retryAfter: 0 }
}

const router = new Router()

// GET /cs/welcome — 欢迎语 + 后台可配（登录/游客均可）
router.get('/cs/welcome', async (ctx) => {
  const configured = await getAdminSetting(ctx.state.env, CS_WELCOME_SETTING_KEY)
  ok(ctx, { welcome: configured?.trim() || DEFAULT_WELCOME })
})

// POST /cs/message — 发送消息，获取 AI 回复（登录/游客均可）
// 传 intent（快捷选项）时忽略 message，使用意图预设文案 + 模型定向指令
router.post('/cs/message', async (ctx) => {
  const { message, intent } = ctx.request.body as { message?: string; intent?: string }
  const intentDef = intent ? CS_INTENTS[intent] : undefined
  if (intent && !intentDef) {
    fail(ctx, 400, 'errors.csEmpty')
    return
  }
  if (!intentDef && !message?.trim()) {
    fail(ctx, 400, 'errors.csEmpty')
    return
  }
  if (message && message.length > 2000) {
    fail(ctx, 400, 'errors.csTooLong')
    return
  }

  const isGuest = !ctx.state.userId
  let effectiveUserId: string

  if (isGuest) {
    const ip = getClientIp(ctx)
    effectiveUserId = `guest:${ip}`
    const { limited, retryAfter } = await checkRateLimit(
      ctx.state.redis,
      `cs:rl:${effectiveUserId}`,
      GUEST_HOURLY_LIMIT,
      3600,
    )
    if (limited) {
      fail(ctx, 429, `errors.csTooFrequent:${Math.ceil(retryAfter / 60)}`)
      return
    }
  } else {
    effectiveUserId = ctx.state.userId!
    const { limited } = await checkRateLimit(
      ctx.state.redis,
      `cs:rl:${effectiveUserId}`,
      USER_MINUTE_LIMIT,
      60,
    )
    if (limited) {
      fail(ctx, 429, `errors.csMinuteLimit:${USER_MINUTE_LIMIT}`)
      return
    }
  }

  const result = intentDef
    ? await handleUserMessage(ctx.state.env, effectiveUserId, intentDef.userText, intentDef.hint)
    : await handleUserMessage(ctx.state.env, effectiveUserId, message!.trim())
  ok(ctx, result)
})

// POST /cs/orders — 直接查库返回最近存款/提现订单（登录用户，不经 LLM，秒回结构化数据）
router.post('/cs/orders', async (ctx) => {
  if (!ctx.state.userId) {
    fail(ctx, 401, 'errors.unauthorized')
    return
  }
  const { type } = ctx.request.body as { type?: string }
  if (type !== 'deposit' && type !== 'withdraw') {
    fail(ctx, 400, 'errors.csEmpty')
    return
  }
  const orders = await queryRecentOrders(ctx.state.env, ctx.state.userId, type as OrderKind)
  ok(ctx, { type, orders })
})

// GET /cs/history — 获取历史消息（游客返回空）
router.get('/cs/history', async (ctx) => {
  if (!ctx.state.userId) {
    ok(ctx, { conversation: null, messages: [] })
    return
  }
  const conversation = await getOrCreateConversation(ctx.state.env, ctx.state.userId)
  const messages = await getMessages(ctx.state.env, conversation.id, 50)
  ok(ctx, { conversation, messages })
})

export default router
