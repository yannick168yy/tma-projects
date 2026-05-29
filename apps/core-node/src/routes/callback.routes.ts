import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { providerVerifiers } from '../providers/verifiers.js'

export async function callbackRoutes(app: FastifyInstance) {
  // 聚合商回调入口 — 验签后入队 NATS，立即返回 200
  app.post<{ Params: { provider: string } }>(
    '/callback/:provider',
    async (req, reply) => {
      const { provider } = req.params
      const payload = req.body as Record<string, unknown>

      const verify = providerVerifiers[provider]
      if (!verify) {
        app.log.warn({ provider }, 'Callback: unknown provider')
        return reply.status(400).send({ code: 1, message: 'unknown provider' })
      }

      if (!verify(req, env as unknown as Record<string, string>)) {
        app.log.warn({ provider }, 'Callback: invalid signature')
        return reply.status(401).send({ code: 1, message: 'invalid signature' })
      }

      app.log.info({ provider, payload }, 'Callback received')

      const js = app.js
      await js.publish(
        env.NATS_CALLBACK_SUBJECT,
        JSON.stringify({ provider, payload, receivedAt: Date.now() })
      )

      return reply.send({ code: 0, message: 'ok' })
    }
  )
}
