import type { FastifyInstance } from 'fastify'
import { callbackRoutes } from './callback.routes.js'
import { internalRoutes } from './internal.routes.js'
import { win568WalletRoutes } from './win568-wallet.routes.js'
import { win568OperationRoutes } from './win568-operation.routes.js'

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))
  await app.register(callbackRoutes, { prefix: '/api/v1' })
  await app.register(win568WalletRoutes)
  await app.register(win568OperationRoutes, { prefix: '/internal/win568' })
  await app.register(internalRoutes)
}
