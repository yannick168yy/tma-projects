import type { FastifyInstance } from 'fastify'
import { callbackRoutes } from './callback.routes.js'
import { internalRoutes } from './internal.routes.js'
import { win568WalletRoutes } from './win568-wallet.routes.js'
import { win568OperationRoutes } from './win568-operation.routes.js'
import { biRoutes } from './bi.routes.js'

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))

  // 无租户段的原路径：自营站现有回调地址继续可用。
  // 三方（聚合商/支付商）改 notify URL 要排期，多租户改造不能把线上收款打断。
  await app.register(callbackRoutes, { prefix: '/api/v1' })
  await app.register(win568WalletRoutes)
  await app.register(win568OperationRoutes, { prefix: '/internal/win568' })
  await app.register(internalRoutes)
  await app.register(biRoutes)

  // 带租户段的同一套路径：新租户开站时直接下发 /t/<code>/... 的回调地址，
  // tenant 插件从 :tenantCode 解析归属，不依赖 Host，也不需要和三方协调。
  await app.register(callbackRoutes, { prefix: '/t/:tenantCode/api/v1' })
  await app.register(win568WalletRoutes, { prefix: '/t/:tenantCode' })
  await app.register(win568OperationRoutes, { prefix: '/t/:tenantCode/internal/win568' })
}
