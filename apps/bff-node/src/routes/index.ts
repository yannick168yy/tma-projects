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
import taskRoutes from './task.routes.js'
import teamRoutes from './team.routes.js'
import agentRoutes from './agent.routes.js'
import webhookRoutes from './webhook.routes.js'
import yfpayRoutes from './yfpay.routes.js'
import paymentUnifiedRoutes from './payment-unified.routes.js'
import slotsRoutes from './slots.routes.js'
import betsRoutes from './bets.routes.js'
import turnoverRoutes from './turnover.routes.js'
import rebateRoutes from './rebate.routes.js'
import vipRoutes from './vip.routes.js'
import spinRoutes from './spin.routes.js'
import homeContentRoutes from './home-content.routes.js'
import announcementRoutes from './announcement.routes.js'
import attributionRoutes from './attribution.routes.js'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js'
import { getDepositChannels, YfPayError } from '../services/yfpay.service.js'
import { getPromoConfig } from '../services/promo-config.service.js'
import { getCheckinConfig } from '../services/checkin.service.js'
import { getLevelConfig } from '../services/rebate.service.js'
import { getUser } from '../services/store/index.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { ok, fail } from '../utils/response.js'
import type { RowDataPacket } from 'mysql2/promise'
import { createHash } from 'node:crypto'
import { appDomainsForMarket, defaultAppDomainsForMarket, getSiteDomainMappings, marketForHost, type SiteMarket } from '../services/site-domain.service.js'
import { signRoutes } from '../services/app-route-sign.service.js'
import { recordRouteProbes } from '../services/route-health.service.js'

function requestHost(ctx: import('koa').Context): string {
  for (const raw of [ctx.get('x-viewer-host'), ctx.get('origin'), ctx.get('referer'), ctx.get('host')]) {
    if (!raw) continue
    try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname } catch { /* 继续 */ }
  }
  return ''
}

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
  api.use(announcementRoutes.routes(), announcementRoutes.allowedMethods())
  // 公开：APK 安装归因配对（点下载在登录前，App 首启也在登录前）
  api.use(attributionRoutes.routes(), attributionRoutes.allowedMethods())

  // 公开：前台初始化语言、币种和登录市场时读取当前域名配置。
  api.get('/site/config', async (ctx) => {
    ctx.set('Cache-Control', 'no-store')
    const host = requestHost(ctx)
    const mappings = await getSiteDomainMappings(ctx.state.redis, ctx.state.env)
    ok(ctx, { domain: host.toLowerCase().replace(/^www\./, ''), market: marketForHost(mappings, host) })
  })

  // Android 壳启动探活与线路配置。App 只接受 APK 内置白名单中的域名。
  api.get('/app/bootstrap', async (ctx) => {
    ctx.set('Cache-Control', 'no-store')
    const rawMarket = String(ctx.query.market ?? '').toUpperCase()
    if (rawMarket !== 'PH' && rawMarket !== 'ID') {
      fail(ctx, 400, 'market 必须是 PH 或 ID'); return
    }
    const market = rawMarket as SiteMarket
    const mappings = await getSiteDomainMappings(ctx.state.redis, ctx.state.env)
    // 配置异常（DB 降级、线路被清空）时绝不下发空表：App 收到空表会判定全部线路不可用而起不来
    const configured = appDomainsForMarket(mappings, market)
    const domains = (configured.length > 0 ? configured : defaultAppDomainsForMarket(market)).map((item) => ({
      domain: item.domain,
      url: `https://${item.domain}`,
      priority: item.appPriority,
    }))
    const configVersion = createHash('sha256').update(JSON.stringify(domains)).digest('hex').slice(0, 16)
    // 签名让 App 不必再靠 APK 内置白名单判断可信域名：临时注册的新域名后台配上即可下发，
    // 拿下任一线路域名的攻击者没有私钥，伪造不出线路表。issuedAt 供 App 拒绝重放旧配置。
    const issuedAt = Math.floor(Date.now() / 1000)
    const signature = signRoutes(
      ctx.state.env, market,
      domains.map((item) => ({ domain: item.domain, priority: item.priority })),
      issuedAt,
    )
    ok(ctx, { market, domains, configVersion, issuedAt, signature, serverTime: new Date().toISOString() })
  })

  // 公开：App 上报本次选线的探活结果。没有它后台完全看不到哪条线在被墙、哪条在变慢，
  // 只能等用户报障。只累加计数，不落库、不记用户。
  api.post('/app/route-report', async (ctx) => {
    ctx.set('Cache-Control', 'no-store')
    const body = ctx.request.body as { market?: unknown; selected?: unknown; results?: unknown }
    const market = String(body.market ?? '').toUpperCase()
    if (market !== 'PH' && market !== 'ID') { fail(ctx, 400, 'market 必须是 PH 或 ID'); return }
    if (!Array.isArray(body.results) || body.results.length === 0 || body.results.length > 20) {
      fail(ctx, 400, 'results 必须是 1-20 项的数组'); return
    }
    const probes = body.results.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      const domain = String(row.domain ?? '').trim().toLowerCase()
      const elapsedMs = Number(row.elapsedMs)
      if (!domain) return []
      return [{
        domain,
        ok: row.ok === true,
        elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < 60000 ? elapsedMs : 0,
      }]
    })
    const mappings = await getSiteDomainMappings(ctx.state.redis, ctx.state.env)
    const accepted = await recordRouteProbes(
      ctx.state.redis, market as SiteMarket, mappings, probes,
      String(body.selected ?? '').trim().toLowerCase(),
    )
    ok(ctx, { accepted })
  })

  // 公开：活动参数配置（App 启动即拉，先于登录完成，不含用户数据）
  api.get('/promotions/config', async (ctx) => {
    const [promo, checkin] = await Promise.all([
      getPromoConfig(ctx.state.env),
      getCheckinConfig(ctx.state.env),
    ])
    ok(ctx, { ...promo, checkinEnabled: checkin.enabled })
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
    const requestedCurrency = String(ctx.query.currency ?? 'PHP').toUpperCase()
    const currency = ['PHP', 'IDR', 'USDT', 'USDC'].includes(requestedCurrency) ? requestedCurrency : 'PHP'

    let trialClaimed = false
    let appdlClaimed = false
    let deposited = false
    if (userId) {
      const user = await getUser(ctx.state.redis, userId)
      trialClaimed = Boolean(user?.trialClaimed)
      if (isMysqlEnabled(env)) {
        const pool = getMysqlPool(env)
        const [appdlRows, depRows] = await Promise.all([
          pool.query<RowDataPacket[]>('SELECT 1 FROM bg_app_download_claim WHERE user_id = ? LIMIT 1', [userId]),
          pool.query<RowDataPacket[]>("SELECT 1 FROM bg_deposit_order WHERE user_id = ? AND status = 'paid' LIMIT 1", [userId]),
        ]).then((rs) => rs.map((r) => r[0]))
        appdlClaimed = appdlRows.length > 0
        deposited = depRows.length > 0
      }
    }

    const currencyTiers = cfg.firstdep.tiers[currency] ?? []
    const firstdepMax = currencyTiers.length ? Math.max(...currencyTiers.map((tier) => tier.bonusAmount)) : 0

    // 返水橱窗数：最高等级各大类日封顶加总 ×30 天；封顶全为 0（不封顶）时 monthlyCap=0，客户端展示 Unlimited 卖点
    let cashbackDailyCap = 0
    let cashbackTopRatePct = 0
    try {
      const levelCfg = await getLevelConfig(env, currency)
      const topLevel = levelCfg.reduce((m, it) => Math.max(m, it.level), 0)
      for (const it of levelCfg) {
        if (it.level !== topLevel || !it.enabled) continue
        cashbackDailyCap += it.maxBonus > 0 ? it.maxBonus : 0
        cashbackTopRatePct = Math.max(cashbackTopRatePct, it.ratePct)
      }
    } catch { /* 返水配置不可用时橱窗数为 0 */ }
    const cashbackMonthlyCap = Math.round(cashbackDailyCap * 30)

    const totalShowcase =
      (cfg.trial.enabled ? (cfg.trial.amountByCcy?.[currency] ?? cfg.trial.amount) : 0) +
      (cfg.appdl.enabled ? (cfg.appdl.amountByCcy?.[currency] ?? cfg.appdl.amount) : 0) +
      (cfg.firstdep.enabled ? firstdepMax : 0) +
      cashbackMonthlyCap

    ok(ctx, {
      registered: Boolean(userId),
      currency,
      totalShowcase,
      tasks: {
        trial:    { enabled: cfg.trial.enabled, amount: cfg.trial.amountByCcy?.[currency] ?? cfg.trial.amount, claimed: trialClaimed },
        appdl:    { enabled: cfg.appdl.enabled, amount: cfg.appdl.amountByCcy?.[currency] ?? cfg.appdl.amount, claimed: appdlClaimed },
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
    ledgerRoutes, kycRoutes, checkinRoutes, taskRoutes, promotionRoutes, teamRoutes, agentRoutes, yfpayRoutes, paymentUnifiedRoutes, betsRoutes, turnoverRoutes, vipRoutes,
  ]) {
    api.use(protectedMw, r.routes(), r.allowedMethods())
  }

  return api
}
