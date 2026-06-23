import Router from '@koa/router'
import { createAdminRouter } from './admin/index.js'
import adminSseRoutes from './admin/sse.routes.js'
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
import teamRoutes from './team.routes.js'
import agentRoutes from './agent.routes.js'
import webhookRoutes from './webhook.routes.js'
import yfpayRoutes from './yfpay.routes.js'
import paymentUnifiedRoutes from './payment-unified.routes.js'
import slotsRoutes from './slots.routes.js'
import betsRoutes from './bets.routes.js'
import sgRoutes from './sg.routes.js'
import turnoverRoutes from './turnover.routes.js'
import rebateRoutes from './rebate.routes.js'
import spinRoutes from './spin.routes.js'
import homeContentRoutes from './home-content.routes.js'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js'
import { getDepositChannels, YfPayError } from '../services/yfpay.service.js'
import { getPromoConfig } from '../services/promo-config.service.js'
import { ok, fail } from '../utils/response.js'

export function createApiRouter(): Router {
  const api = new Router({ prefix: '/api/v1' })

  // 管理后台路由（自带 /admin 前缀）
  const adminRouter = createAdminRouter()
  api.use(adminRouter.routes(), adminRouter.allowedMethods())

  // SSE 推送端点：自行在 handler 内验 token，不经过 adminAuthMiddleware
  api.use(adminSseRoutes.routes(), adminSseRoutes.allowedMethods())

  // 无需鉴权：webhook + 登录 + SG回调透传
  api.use(webhookRoutes.routes(), webhookRoutes.allowedMethods())
  api.use(authRoutes.routes(), authRoutes.allowedMethods())
  api.use(sgRoutes.routes(), sgRoutes.allowedMethods())
  api.use(homeContentRoutes.routes(), homeContentRoutes.allowedMethods())

  // 公开：活动参数配置（App 启动即拉，先于登录完成，不含用户数据）
  api.get('/promotions/config', async (ctx) => {
    ok(ctx, await getPromoConfig(ctx.state.env))
  })

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
  // rebate config 公开（无需登录），summary 需登录
  api.use(optMw, rebateRoutes.routes(), rebateRoutes.allowedMethods())

  // 转盘：/status 游客可见（次数为 0），/draw /records 在 handler 内自查 userId
  api.use(optMw, spinRoutes.routes(), spinRoutes.allowedMethods())

  for (const r of [
    userRoutes, walletRoutes, depositRoutes, tonDepositRoutes, withdrawRoutes,
    ledgerRoutes, kycRoutes, promotionRoutes, teamRoutes, agentRoutes, yfpayRoutes, paymentUnifiedRoutes, betsRoutes, turnoverRoutes,
  ]) {
    api.use(protectedMw, r.routes(), r.allowedMethods())
  }

  return api
}
