import Router from '@koa/router'
import { getAdminSession } from '../../services/admin-auth.service.js'
import { addSseBadgeClient, removeSseBadgeClient, broadcastBadges } from '../../services/sse-badges.js'

// 此路由在 api 层直接挂载（不经过 adminAuthMiddleware），因为 EventSource 不支持自定义 header
// token 通过 query param 传入，在此处手动验证
const router = new Router({ prefix: '/admin/dashboard' })

router.get('/badges/stream', async (ctx) => {
  const token = String(ctx.query.token ?? '')
  const session = await getAdminSession(ctx.state.redis, token)
  if (!session) { ctx.status = 401; ctx.body = 'Unauthorized'; return }

  ctx.set('Content-Type', 'text/event-stream')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.set('X-Accel-Buffering', 'no')
  ctx.respond = false
  ctx.res.writeHead(200)

  const client = {
    write: (data: string) => {
      try { ctx.res.write(`data: ${data}\n\n`) } catch { /* 连接已断开 */ }
    },
  }

  addSseBadgeClient(client)

  // 建立连接后立即推送当前数值
  broadcastBadges(ctx.state.env).catch(() => {})

  // 每 25 秒心跳，防止 nginx 因空闲超时断连
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
