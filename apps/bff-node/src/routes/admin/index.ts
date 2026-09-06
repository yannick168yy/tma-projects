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
import announcementRoutes from './announcement.routes.js'
import securityRoutes from './security.routes.js'
import deviceLookupRoutes from './device-lookup.routes.js'
import checkinRoutes from './checkin.routes.js'
import taskRoutes from './task.routes.js'
import riskRoutes from './risk.routes.js'
import communityRoutes from './community.routes.js'
import broadcastRoutes from './broadcast.routes.js'
import biRoutes from './bi.routes.js'
import marketingRoutes from './marketing.routes.js'
import dbBackupRoutes from './db-backup.routes.js'
import growthRoutes from './growth.routes.js'
import platformBillingRoutes from './platform-billing.routes.js'
import selfServiceRoutes from './self-service.routes.js'

import { getTenantFeatures } from '../../services/tenant-feature.service.js'
import { ok } from '../../utils/response.js'

export function createAdminRouter(): Router {
  const admin = new Router({ prefix: '/admin' })

  // 无需鉴权
  admin.use(authRoutes.routes(), authRoutes.allowedMethods())

  // 需要 admin token
  const guard = adminAuthMiddleware()

  // 后台启动自举（P1-7/P1-8）：角色与功能开关一次下发。
  //
  // 🔴 role 必须来自服务端会话，不能由前端读 localStorage 自称。
  // 之前 web-admin 的 RequireRole 只看 localStorage.admin_role，改一行就能点进
  // 超管页面 —— 后端各路由有 requireRole 兜底所以数据没漏，但前端等于没有守卫。
  //
  // features 只下发不校验：菜单是体验层，真正的边界在 requireFeature / requireRole。
  admin.get('/auth/me', guard, async (ctx) => {
    const tenant = ctx.state.tenant
    ok(ctx, {
      adminId: ctx.state.adminId,
      username: ctx.state.adminUsername,
      role: ctx.state.adminRole,
      features: tenant ? await getTenantFeatures(ctx.state.env, tenant.id) : {},
    })
  })
  for (const r of [dashboardRoutes, usersRoutes, depositsRoutes, withdrawalsRoutes, auditRoutes, gamesRoutes, settingsRoutes, securityRoutes, csRoutes, betOrdersRoutes, teamRoutes, agentRoutes, promotionsRoutes, rebateRoutes, vipRoutes, spinRoutes, homeContentRoutes, announcementRoutes, reviewRoutes, kycRoutes, paymentRoutes, ledgerRoutes, deviceLookupRoutes, checkinRoutes, taskRoutes, riskRoutes, communityRoutes, broadcastRoutes, biRoutes, marketingRoutes, dbBackupRoutes, growthRoutes, platformBillingRoutes, selfServiceRoutes]) {
    admin.use(guard, r.routes(), r.allowedMethods())
  }

  return admin
}
