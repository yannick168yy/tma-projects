import Router from '@koa/router'
import { getStorageProvider } from '../services/storage/index.js'
import { getHomeContent } from '../services/home-content.service.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/home' })

router.get('/content', async (ctx) => {
  ok(ctx, await getHomeContent(ctx.state.env, false, String(ctx.query.locale ?? 'en')))
})

// 用通配捕获：key 含斜杠(home/banner/xxx.webp)，nginx 反代会把 %2F 解码成 /，
// 单段 :key 会匹配失败，故用 (.*) 吃下整段路径
router.get('/images/(.*)', async (ctx) => {
  const key = decodeURIComponent(ctx.params[0] ?? '')
  // brand/ 是 P1-10 的品牌资产。走同一个出口是有意的：这条路由按 Host 认租户、
  // 再按租户前缀读文件，各租户的资产天然隔离，不需要另起一套服务路径。
  if ((!key.startsWith('home/') && !key.startsWith('covers/') && !key.startsWith('brand/')) || key.includes('..') || key.startsWith('/')) {
    fail(ctx, 400, 'Invalid image key')
    return
  }

  const file = await getStorageProvider(ctx.state.env).get(key)
  if (!file) {
    fail(ctx, 404, 'Image file not found', 404)
    return
  }

  ctx.set('Content-Type', file.mimeType)
  ctx.set('Cache-Control', 'public, max-age=31536000, immutable')
  ctx.body = file.data
})

export default router
