import Router from '@koa/router'
import { getDashboardStats } from '../../services/admin-store.js'
import { getAdminSession } from '../../services/admin-auth.service.js'
import { addSseBadgeClient, removeSseBadgeClient, fetchBadgeCounts, broadcastBadges } from '../../services/sse-badges.js'
import { ok } from '../../utils/response.js'

const router = new Router({ prefix: '/dashboard' })

router.get('/', async (ctx) => {
  const stats = await getDashboardStats(ctx.state.env)
  ok(ctx, stats)
})

// HTTP 轮询备用（前端 EventSource 不可用时 fallback）
router.get('/badges', async (ctx) => {
  const badges = await fetchBadgeCounts(ctx.state.env)
  ok(ctx, badges)
})

// SSE 实时推送 — EventSource 不支持自定义 header，token 走 query param
router.get('/badges/stream', async (ctx) => {
  const token = String(ctx.query.token ?? '')
  const session = await getAdminSession(ctx.state.redis, token)
  if (!session) { ctx.status = 401; ctx.body = 'Unauthorized'; return }

  ctx.set('Content-Type', 'text/event-stream')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.set('X-Accel-Buffering', 'no') // 禁止 nginx 缓冲 SSE
  ctx.respond = false
  ctx.res.writeHead(200)

  const client = {
    write: (data: string) => {
      try { ctx.res.write(`data: ${data}\n\n`) } catch { /* 连接已断开 */ }
    },
  }

  addSseBadgeClient(client)

  // 连接建立后立即推送当前数值
  try {
    await broadcastBadges(ctx.state.env)
  } catch { /* ignore */ }

  // 每 25 秒发心跳，防止 nginx/代理超时断连
  const heartbeat = setInterval(() => {
    try { ctx.res.write(': heartbeat\n\n') } catch { /* ignore */ }
  }, 25_000)

  await new Promise<void>((resolve) => {
    ctx.req.on('close', resolve)
    ctx.req.on('error', resolve)
  })

  clearInterval(heartbeat)
  removeSseBadgeClient(client)
  try { ctx.res.end() } catch { /* ignore */ }
})

export default router
