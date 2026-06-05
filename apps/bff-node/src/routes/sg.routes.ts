import Router from '@koa/router'

const router = new Router({ prefix: '/sg' })

// SG 回调透传到 core-node（SG 商户后台配置的 URL 打到了 bff-node:3000，实际处理在 core-node:4000）
router.post('/callback', async (ctx) => {
  const coreUrl = `${ctx.state.env.CORE_NODE_URL}/api/v1/sg/callback`
  const body = JSON.stringify(ctx.request.body)

  // 转发原始请求头（保留 SG HMAC 签名头），排除 content-length（body 序列化后长度相同，但避免 encoding 差异）
  const forwardHeaders: Record<string, string> = { 'content-type': 'application/json' }
  for (const [k, v] of Object.entries(ctx.headers)) {
    if (k === 'content-length' || k === 'host' || k === 'connection') continue
    if (v) forwardHeaders[k] = Array.isArray(v) ? v[0] : v
  }

  const res = await fetch(coreUrl, { method: 'POST', headers: forwardHeaders, body })
  const data = await res.json()
  ctx.status = res.status
  ctx.body = data
})

export default router
