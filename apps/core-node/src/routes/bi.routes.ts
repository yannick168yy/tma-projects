import type { FastifyInstance } from 'fastify'
import { aggregateBiDay, aggregateBiRange, detectBiAlerts, manilaToday } from '../services/bi-aggregate.service.js'

// BI 聚合内部接口：手动触发重算/回填（bff 转发或运维直调）
export async function biRoutes(app: FastifyInstance) {
  app.post<{ Body: { date?: string; from?: string; to?: string } }>(
    '/internal/bi/aggregate',
    async (req, reply) => {
      const { date, from, to } = req.body ?? {}
      if (from && to) {
        const days = await aggregateBiRange(app, from, to)
        return reply.send({ code: 0, message: 'ok', days })
      }
      const d = date ?? manilaToday()
      await aggregateBiDay(app, d)
      return reply.send({ code: 0, message: 'ok', date: d })
    },
  )

  app.post<{ Body: { date?: string } }>('/internal/bi/detect-alerts', async (req, reply) => {
    const d = req.body?.date ?? manilaToday(-1)
    const inserted = await detectBiAlerts(app, d)
    return reply.send({ code: 0, message: 'ok', date: d, inserted })
  })
}
