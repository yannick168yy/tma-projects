import Router from '@koa/router'
import { createAdminRouter } from './admin/index.js'
import authRoutes from './auth.routes.js'
import csRoutes from './cs.routes.js'
import userRoutes from './user.routes.js'
import walletRoutes from './wallet.routes.js'
import depositRoutes from './deposit.routes.js'
import tonDepositRoutes from './ton-deposit.routes.js'
import withdrawRoutes from './withdraw.routes.js'
import ledgerRoutes from './ledger.routes.js'
import kycRoutes from './kyc.routes.js'
import promotionRoutes from './promotion.routes.js'
import webhookRoutes from './webhook.routes.js'
import yfpayCallbackRoutes from './yfpay-callback.routes.js'
import yfpayRoutes from './yfpay.routes.js'
import matrixCallbackRoutes from './matrix-callback.routes.js'
import slotsRoutes from './slots.routes.js'
import sgCallbackRoutes from './sg-callback.routes.js'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js'
import { getDepositChannels, YfPayError } from '../services/yfpay.service.js'
import { ok, fail } from '../utils/response.js'

export function createApiRouter(): Router {
  const api = new Router({ prefix: '/api/v1' })

  // 管理后台路由（自带 /admin 前缀）
  const adminRouter = createAdminRouter()
  api.use(adminRouter.routes(), adminRouter.allowedMethods())

  // 无需鉴权：webhook + 回调 + 登录
  api.use(webhookRoutes.routes(), webhookRoutes.allowedMethods())
  api.use(yfpayCallbackRoutes.routes(), yfpayCallbackRoutes.allowedMethods())
  api.use(sgCallbackRoutes.routes(), sgCallbackRoutes.allowedMethods())
  api.use(matrixCallbackRoutes.routes(), matrixCallbackRoutes.allowedMethods())
  api.use(authRoutes.routes(), authRoutes.allowedMethods())

  // 公开：YF Pay 存款频道
  api.get('/deposit/yfpay/channels', async (ctx) => {
    try {
      const channels = await getDepositChannels(ctx.state.env)
      ok(ctx, channels)
    } catch (err) {
      const msg = err instanceof YfPayError ? err.message : '获取通道失败'
      fail(ctx, 500, msg)
    }
  })

  // 游戏大厅：游戏列表/demo 公开，/init /sync 需要鉴权（handler 内检查 userId）
  const optMw = optionalAuthMiddleware()
  api.use(optMw, slotsRoutes.routes(), slotsRoutes.allowedMethods())

  // 客服：游客也可访问，内部自行处理防刷和权限
  api.use(optMw, csRoutes.routes(), csRoutes.allowedMethods())

  const protectedMw = authMiddleware()
  for (const r of [
    userRoutes, walletRoutes, depositRoutes, tonDepositRoutes, withdrawRoutes,
    ledgerRoutes, kycRoutes, promotionRoutes, yfpayRoutes,
  ]) {
    api.use(protectedMw, r.routes(), r.allowedMethods())
  }

  return api
}
