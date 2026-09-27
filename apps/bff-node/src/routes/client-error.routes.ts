import Router from '@koa/router'
import { ok } from '../utils/response.js'

// 前端运行时错误上报（公开，无需登录）：真机上的白屏/黑屏只有这里能看到堆栈。
// 只写容器日志（grep "[client-error]"），不落库；字段截断防止被灌大包。
const router = new Router({ prefix: '/client-errors' })

const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined)

router.post('/', (ctx) => {
  const b = (ctx.request.body ?? {}) as Record<string, unknown>
  console.warn('[client-error]', JSON.stringify({
    kind: cut(b.kind, 32),
    message: cut(b.message, 500),
    stack: cut(b.stack, 2000),
    url: cut(b.url, 300),
    build: cut(b.build, 64),
    userId: cut(b.userId, 32),
    ua: ctx.get('user-agent').slice(0, 300),
    ip: ctx.ip,
  }))
  ok(ctx, { ok: true })
})

export default router
