import Router from '@koa/router'
import { adminAuthMiddleware } from '../../middleware/admin-auth.js'
import authRoutes from './auth.routes.js'
import dashboardRoutes from './dashboard.routes.js'
import usersRoutes from './users.routes.js'
import depositsRoutes from './deposits.routes.js'
import withdrawalsRoutes from './withdrawals.routes.js'
import auditRoutes from './audit.routes.js'
import gamesRoutes from './games.routes.js'

export function createAdminRouter(): Router {
  const admin = new Router({ prefix: '/admin' })

  // 无需鉴权
  admin.use(authRoutes.routes(), authRoutes.allowedMethods())

  // 需要 admin token
  const guard = adminAuthMiddleware()
  for (const r of [dashboardRoutes, usersRoutes, depositsRoutes, withdrawalsRoutes, auditRoutes, gamesRoutes]) {
    admin.use(guard, r.routes(), r.allowedMethods())
  }

  return admin
}
