import Router from '@koa/router'
import { verifySgCallback } from '../services/slotegrator.service.js'

const router = new Router({ prefix: '/sg' })

router.post('/callback', async (ctx) => {
  const env = ctx.state.env
  const body = ctx.request.body as Record<string, string>

  // HMAC 签名验证
  const hasCreds = Boolean(env.SG_MERCHANT_KEY && env.SG_MERCHANT_ID)
  if (hasCreds && !verifySgCallback(body, ctx.headers as Record<string, string | string[] | undefined>, env.SG_MERCHANT_KEY)) {
    ctx.status = 200
    ctx.body = { error_code: 'INTERNAL_ERROR', error_description: 'Invalid signature' }
    return
  }

  // 转发到 core-node
  const coreUrl = `${env.CORE_NODE_URL}/internal/sg/callback`
  try {
    const resp = await fetch(coreUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': env.INTERNAL_TOKEN ?? '',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    ctx.status = 200
    ctx.body = await resp.json()
  } catch (e) {
    ctx.status = 200
    ctx.body = { error_code: 'INTERNAL_ERROR', error_description: 'Service unavailable' }
  }
})

export default router
