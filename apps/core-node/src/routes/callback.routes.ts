import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'

export async function callbackRoutes(app: FastifyInstance) {
  // 聚合商回调入口 — 验签后入队 NATS，立即返回 200
  app.post<{ Params: { provider: string } }>(
    '/callback/:provider',
    async (req, reply) => {
      const { provider } = req.params
      const payload = req.body as Record<string, unknown>

      // TODO: 按 provider 做签名验证（各厂商适配器）
      app.log.info({ provider, payload }, 'Callback received')

      // 入队 NATS JetStream
      const js = app.js
      await js.publish(
        env.NATS_CALLBACK_SUBJECT,
        JSON.stringify({ provider, payload, receivedAt: Date.now() })
      )

      return reply.send({ code: 0, message: 'ok' })
    }
  )
}
