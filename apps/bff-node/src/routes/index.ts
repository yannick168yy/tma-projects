import Router from '@koa/router'
import { createAdminRouter } from './admin/index.js'
import adminSseRoutes from './admin/sse.routes.js'
import authRoutes from './auth.routes.js'
import csRoutes from './cs.routes.js'
import userRoutes from './user.routes.js'
import walletRoutes from './wallet.routes.js'
import depositRoutes from './deposit.routes.js'
import withdrawRoutes from './withdraw.routes.js'
import ledgerRoutes from './ledger.routes.js'
import kycRoutes from './kyc.routes.js'
import promotionRoutes from './promotion.routes.js'
import checkinRoutes from './checkin.routes.js'
import teamRoutes from './team.routes.js'
import agentRoutes from './agent.routes.js'
import webhookRoutes from './webhook.routes.js'
import yfpayRoutes from './yfpay.routes.js'
import paymentUnifiedRoutes from './payment-unified.routes.js'
import slotsRoutes from './slots.routes.js'
import betsRoutes from './bets.routes.js'
import turnoverRoutes from './turnover.routes.js'
import rebateRoutes from './rebate.routes.js'
import spinRoutes from './spin.routes.js'
import homeContentRoutes from './home-content.routes.js'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js'
import { getDepositChannels, YfPayError } from '../services/yfpay.service.js'
import { getPromoConfig } from '../services/promo-config.service.js'
import { getLevelConfig } from '../services/rebate.service.js'
import { getUser } from '../services/store/index.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { ok, fail } from '../utils/response.js'
import type { RowDataPacket } from 'mysql2/promise'

export function createApiRouter(): Router {
  const api = new Router({ prefix: '/api/v1' })

  // 管理后台路由（自带 /admin 前缀）
  const adminRouter = createAdminRouter()
  api.use(adminRouter.routes(), adminRouter.allowedMethods())

  // SSE 推送端点：自行在 handler 内验 token，不经过 adminAuthMiddleware
  api.use(adminSseRoutes.routes(), adminSseRoutes.allowedMethods())

  // 无需鉴权：webhook + 登录
  api.use(webhookRoutes.routes(), webhookRoutes.allowedMethods())
  api.use(authRoutes.routes(), authRoutes.allowedMethods())
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

  // 游戏大厅：游戏列表公开，/init 需要鉴权（handler 内检查 userId）
  const optMw = optionalAuthMiddleware()

  // 新人礼包聚合：三步任务状态 + 大数字总额（游客可拉，登录后带真实领取状态）
  api.get('/promotions/new-player-summary', optMw, async (ctx) => {
    const env = ctx.state.env
    const cfg = await getPromoConfig(env)
    const userId = ctx.state.userId as string | undefined

    let trialClaimed = false
    let appdlClaimed = false
    let deposited = false
    if (userId) {
      const user = await getUser(ctx.state.redis, userId)
      trialClaimed = Boolean(user?.trialClaimed)
      if (isMysqlEnabled(env)) {
        const pool = getMysqlPool(env)
        const [[appdlRow], [depRow]] = await Promise.all([
          pool.query<RowDataPacket[]>('SELECT 1 FROM bg_app_download_claim WHERE user_id = ? LIMIT 1', [userId]),
          pool.query<RowDataPacket[]>("SELECT 1 FROM bg_deposit_order WHERE user_id = ? AND status = 'paid' LIMIT 1", [userId]),
        ]).then((rs) => rs.map((r) => r[0]))
        appdlClaimed = appdlRow.length > 0
        deposited = depRow.length > 0
      }
    }

    const phpTiers = cfg.firstdep.tiers.PHP ?? []
    const firstdepMax = phpTiers.length ? Math.max(...phpTiers.map((tier) => tier.bonusAmount)) : 0

    // 返水橱窗数：最高等级各大类日封顶加总 ×30 天；封顶全为 0（不封顶）时 monthlyCap=0，客户端展示 Unlimited 卖点
    let cashbackDailyCap = 0
    let cashbackTopRatePct = 0
    try {
      const levelCfg = await getLevelConfig(env)
      const topLevel = levelCfg.reduce((m, it) => Math.max(m, it.level), 0)
      for (const it of levelCfg) {
        if (it.level !== topLevel || !it.enabled) continue
        cashbackDailyCap += it.maxBonus > 0 ? it.maxBonus : 0
        cashbackTopRatePct = Math.max(cashbackTopRatePct, it.ratePct)
      }
    } catch { /* 返水配置不可用时橱窗数为 0 */ }
    const cashbackMonthlyCap = Math.round(cashbackDailyCap * 30)

    const totalShowcase =
      (cfg.trial.enabled ? cfg.trial.amount : 0) +
      (cfg.appdl.enabled ? cfg.appdl.amount : 0) +
      (cfg.firstdep.enabled ? firstdepMax : 0) +
      cashbackMonthlyCap

    ok(ctx, {
      registered: Boolean(userId),
      totalShowcase,
      tasks: {
        trial:    { enabled: cfg.trial.enabled, amount: cfg.trial.amount, claimed: trialClaimed },
        appdl:    { enabled: cfg.appdl.enabled, amount: cfg.appdl.amount, claimed: appdlClaimed },
        firstdep: { enabled: cfg.firstdep.enabled, maxBonus: firstdepMax, done: deposited },
      },
      cashback: { dailyCap: cashbackDailyCap, monthlyCap: cashbackMonthlyCap, topRatePct: cashbackTopRatePct },
    })
  })
  api.use(optMw, slotsRoutes.routes(), slotsRoutes.allowedMethods())

  // 客服：游客也可访问，内部自行处理防刷和权限
  api.use(optMw, csRoutes.routes(), csRoutes.allowedMethods())

  const protectedMw = authMiddleware()
  // rebate config 公开（无需登录），summary 需登录
  api.use(optMw, rebateRoutes.routes(), rebateRoutes.allowedMethods())

  // 转盘：/status 游客可见（次数为 0），/draw /records 在 handler 内自查 userId
  api.use(optMw, spinRoutes.routes(), spinRoutes.allowedMethods())

  for (const r of [
    userRoutes, walletRoutes, depositRoutes, withdrawRoutes,
    ledgerRoutes, kycRoutes, promotionRoutes, checkinRoutes, teamRoutes, agentRoutes, yfpayRoutes, paymentUnifiedRoutes, betsRoutes, turnoverRoutes,
  ]) {
    api.use(protectedMw, r.routes(), r.allowedMethods())
  }

  return api
}
