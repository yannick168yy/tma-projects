import Router from '@koa/router'
import { adminAuthMiddleware } from '../../middleware/admin-auth.js'
import authRoutes from './auth.routes.js'
import dashboardRoutes from './dashboard.routes.js'
import usersRoutes from './users.routes.js'
import depositsRoutes from './deposits.routes.js'
import withdrawalsRoutes from './withdrawals.routes.js'
import auditRoutes from './audit.routes.js'
import gamesRoutes from './games.routes.js'
import settingsRoutes from './settings.routes.js'
import csRoutes from './cs.routes.js'
import betOrdersRoutes from './bet-orders.routes.js'
import teamRoutes from './team.routes.js'
import agentRoutes from './agent.routes.js'
import promotionsRoutes from './promotions.routes.js'
import rebateRoutes from './rebate.routes.js'
import vipRoutes from './vip.routes.js'
import reviewRoutes from './review.routes.js'
import kycRoutes from './kyc.routes.js'
import paymentRoutes from './payment.routes.js'
import spinRoutes from './spin.routes.js'
import ledgerRoutes from './ledger.routes.js'
import homeContentRoutes from './home-content.routes.js'
import securityRoutes from './security.routes.js'
import deviceLookupRoutes from './device-lookup.routes.js'
import checkinRoutes from './checkin.routes.js'
import taskRoutes from './task.routes.js'
import riskRoutes from './risk.routes.js'
import communityRoutes from './community.routes.js'

export function createAdminRouter(): Router {
  const admin = new Router({ prefix: '/admin' })

  // 无需鉴权
  admin.use(authRoutes.routes(), authRoutes.allowedMethods())

  // 需要 admin token
  const guard = adminAuthMiddleware()
  for (const r of [dashboardRoutes, usersRoutes, depositsRoutes, withdrawalsRoutes, auditRoutes, gamesRoutes, settingsRoutes, securityRoutes, csRoutes, betOrdersRoutes, teamRoutes, agentRoutes, promotionsRoutes, rebateRoutes, vipRoutes, spinRoutes, homeContentRoutes, reviewRoutes, kycRoutes, paymentRoutes, ledgerRoutes, deviceLookupRoutes, checkinRoutes, taskRoutes, riskRoutes, communityRoutes]) {
    admin.use(guard, r.routes(), r.allowedMethods())
  }

  return admin
}
