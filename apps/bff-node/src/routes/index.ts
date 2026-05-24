import Router from '@koa/router'
import authRoutes from './auth.routes.js'
import userRoutes from './user.routes.js'
import walletRoutes from './wallet.routes.js'
import depositRoutes from './deposit.routes.js'
import withdrawRoutes from './withdraw.routes.js'
import ledgerRoutes from './ledger.routes.js'
import kycRoutes from './kyc.routes.js'
import promotionRoutes from './promotion.routes.js'
import { authMiddleware } from '../middleware/auth.js'

export function createApiRouter(): Router {
  const api = new Router({ prefix: '/api/v1' })

  api.use(authRoutes.routes(), authRoutes.allowedMethods())

  const protectedMw = authMiddleware()
  for (const r of [userRoutes, walletRoutes, depositRoutes, withdrawRoutes, ledgerRoutes, kycRoutes, promotionRoutes]) {
    api.use(protectedMw, r.routes(), r.allowedMethods())
  }

  return api
}
