import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { SgCallbackService } from '../services/sg-callback.service.js'
import { providerVerifiers } from '../providers/verifiers.js'

export async function sgCallbackRoutes(app: FastifyInstance) {
  const svc = new SgCallbackService(app)

  // 直接对外暴露，SG 自带 HMAC 验签（注册在 /api/v1 前缀下）
  app.post('/sg/callback', async (req, reply) => {
    const hasCreds = Boolean(env.SG_MERCHANT_KEY && env.SG_MERCHANT_ID)
    if (hasCreds && !providerVerifiers.sg(req, env as unknown as Record<string, string>)) {
      app.log.warn('SG callback: invalid signature')
      return reply.send({ error_code: 'INTERNAL_ERROR', error_description: 'Invalid signature' })
    }

    const body = req.body as import('../services/sg-callback.service.js').SgCallbackBody
    const sgCurrency = (env.SG_CURRENCY || 'EUR').toUpperCase()

    const result = await svc.handle(body, sgCurrency)
    return reply.send(result)
  })
}
