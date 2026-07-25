import Router from '@koa/router'
import { ok } from '../utils/response.js'
import { savePendingInstall, matchPendingInstall } from '../services/attribution.service.js'

// 站外 APK 安装归因配对（公开，无需登录）：
//   download-click —— 浏览器侧点 APK 下载时，把 betogo_attr 快照落 bg_pending_install
//   app-first-open —— App 首启认领快照，前端写回本地存储后注册照旧走 X-Attr
// 全链路尽力而为：失败只影响这一个安装的归因，绝不阻断下载/启动。
const router = new Router({ prefix: '/attribution' })

router.post('/download-click', async (ctx) => {
  const body = (ctx.request.body ?? {}) as { attr?: unknown; dk?: unknown }
  const stored = await savePendingInstall(ctx.state.env, body.attr, {
    ip: ctx.ip,
    userAgent: ctx.get('user-agent'),
    deviceKey: body.dk,
  }).catch(() => false)
  ok(ctx, { stored })
})

router.post('/app-first-open', async (ctx) => {
  const body = (ctx.request.body ?? {}) as { dk?: unknown }
  const attr = await matchPendingInstall(ctx.state.env, {
    ip: ctx.ip,
    userAgent: ctx.get('user-agent'),
    deviceKey: body.dk,
  }).catch(() => null)
  ok(ctx, { attr })
})

export default router
