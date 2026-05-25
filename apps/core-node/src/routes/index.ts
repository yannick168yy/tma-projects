import type { FastifyInstance } from 'fastify'
import { callbackRoutes } from './callback.routes.js'

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))
  await app.register(callbackRoutes, { prefix: '/api/v1' })
}
