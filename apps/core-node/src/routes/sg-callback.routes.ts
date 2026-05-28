import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { SgCallbackService } from '../services/sg-callback.service.js'

export async function sgCallbackRoutes(app: FastifyInstance) {
  const svc = new SgCallbackService(app)

  app.post('/internal/sg/callback', async (req, reply) => {
    // 内部 token 校验（防止非 bff-node 调用）
    const token = req.headers['x-internal-token']
    if (env.INTERNAL_TOKEN && token !== env.INTERNAL_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const body = req.body as import('../services/sg-callback.service.js').SgCallbackBody
    const sgCurrency = (env.SG_CURRENCY || 'EUR').toUpperCase()

    const result = await svc.handle(body, sgCurrency)
    return reply.send(result)
  })
}
