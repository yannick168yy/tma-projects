import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { ok, fail } from '../utils/response.js'
import { savePendingInstall, matchPendingInstall } from '../services/attribution.service.js'

// 站外 APK 安装归因配对（公开，无需登录）：
//   download-click —— 浏览器侧点 APK 下载时，把 betogo_attr 快照落 bg_pending_install
//   app-first-open —— App 首启认领快照，前端写回本地存储后注册照旧走 X-Attr
// 全链路尽力而为：失败只影响这一个安装的归因，绝不阻断下载/启动。
const router = new Router({ prefix: '/attribution' })

// 短链解析（公开）：/t/<code> 落地后前端用 code 换出该线的渠道标识与像素 ID。
// 只回投放链接本来就公开携带的字段（c/px/tpx），token 等敏感数据绝不出去。
router.get('/resolve/:code', async (ctx) => {
  const code = String(ctx.params.code ?? '').trim()
  if (!/^[\w.-]{1,64}$/.test(code) || !isMysqlEnabled(ctx.state.env)) { fail(ctx, 404, 'not found', 404); return }
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT platform, pixel_id FROM bg_capi_pixel_token WHERE channel_code = ?`,
    [code],
  )
  if (!rows.length) { fail(ctx, 404, 'not found', 404); return }
  let px: string | undefined
  let tpx: string | undefined
  for (const r of rows) {
    if (String(r.platform) === 'facebook') px = String(r.pixel_id)
    else if (String(r.platform) === 'tiktok') tpx = String(r.pixel_id)
  }
  ok(ctx, { c: code, px: px ?? null, tpx: tpx ?? null })
})

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
  const result = await matchPendingInstall(ctx.state.env, {
    ip: ctx.ip,
    userAgent: ctx.get('user-agent'),
    deviceKey: body.dk,
  }).catch(() => null)
  // 识别率观测：按 outcome 聚合即可算命中率与损失构成（ambiguous=配对系统损失，none=没点过/超窗）
  console.log(`[attr-pair] outcome=${result?.outcome ?? 'error'} candidates=${result?.candidates ?? 0} dk=${String(body.dk ?? '')}`)
  ok(ctx, { attr: result?.attr ?? null })
})

export default router
