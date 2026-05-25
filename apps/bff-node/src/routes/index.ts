import Router from '@koa/router'
import authRoutes from './auth.routes.js'
import userRoutes from './user.routes.js'
import walletRoutes from './wallet.routes.js'
import depositRoutes from './deposit.routes.js'
import withdrawRoutes from './withdraw.routes.js'
import ledgerRoutes from './ledger.routes.js'
import kycRoutes from './kyc.routes.js'
import promotionRoutes from './promotion.routes.js'
import webhookRoutes from './webhook.routes.js'
import yfpayCallbackRoutes from './yfpay-callback.routes.js'
import yfpayRoutes from './yfpay.routes.js'
import { authMiddleware } from '../middleware/auth.js'
import { getDepositChannels, YfPayError } from '../services/yfpay.service.js'
import { ok, fail } from '../utils/response.js'

export function createApiRouter(): Router {
  const api = new Router({ prefix: '/api/v1' })

  // 无需鉴权：webhook + 回调 + 登录 + 公开接口
  api.use(webhookRoutes.routes(), webhookRoutes.allowedMethods())
  api.use(yfpayCallbackRoutes.routes(), yfpayCallbackRoutes.allowedMethods())
  api.use(authRoutes.routes(), authRoutes.allowedMethods())

  // 公开：YF Pay 存款频道（不含账户信息，无需登录即可展示支付方式）
  api.get('/deposit/yfpay/channels', async (ctx) => {
    try {
      const channels = await getDepositChannels(ctx.state.env)
      ok(ctx, channels)
    } catch (err) {
      const msg = err instanceof YfPayError ? err.message : '获取通道失败'
      fail(ctx, 500, msg)
    }
  })

  const protectedMw = authMiddleware()
  for (const r of [userRoutes, walletRoutes, depositRoutes, withdrawRoutes, ledgerRoutes, kycRoutes, promotionRoutes, yfpayRoutes]) {
    api.use(protectedMw, r.routes(), r.allowedMethods())
  }

  return api
}
