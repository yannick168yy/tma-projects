import Router from '@koa/router'
import { getStorageProvider } from '../services/storage/index.js'
import { getHomeContent } from '../services/home-content.service.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/home' })

router.get('/content', async (ctx) => {
  ok(ctx, await getHomeContent(ctx.state.env))
})

router.get('/images/:key', async (ctx) => {
  const key = decodeURIComponent(ctx.params.key)
  if (!key.startsWith('home/') || key.includes('..') || key.startsWith('/')) {
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
