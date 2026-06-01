import type { FastifyInstance } from 'fastify'
import { callbackRoutes } from './callback.routes.js'
import { sgCallbackRoutes } from './sg-callback.routes.js'
import { internalRoutes } from './internal.routes.js'

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))
  await app.register(callbackRoutes, { prefix: '/api/v1' })
  await app.register(sgCallbackRoutes)
  await app.register(internalRoutes)
}
