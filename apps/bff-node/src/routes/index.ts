import Router from '@koa/router'
import { createAdminRouter } from './admin/index.js'
import { createPlatformRouter } from './platform/index.js'
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
import { requireFeature } from '../middleware/require-feature.js'
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
import { getTenantFeatures } from '../services/tenant-feature.service.js'
import { DEFAULT_BRAND, getTenantBrand, getTenantMarkets } from '../services/brand.service.js'
import { getTenantI18nOverrides } from '../services/tenant-i18n.service.js'

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

  // 平台控制台：与租户后台分离的独立命名空间
  const platformRouter = createPlatformRouter()
  api.use(platformRouter.routes(), platformRouter.allowedMethods())

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
  // P1-8 起同时下发功能开关：前台靠它决定路由与底部导航显示哪些模块。
  // domain/market 是既有字段，只增不改 —— 老版前端拿到多余字段会忽略。
  api.get('/site/config', async (ctx) => {
    ctx.set('Cache-Control', 'no-store')
    const host = requestHost(ctx)
    const env = ctx.state.env
    const mappings = await getSiteDomainMappings(ctx.state.redis, env)
    const tenant = ctx.state.tenant
    const market = marketForHost(mappings, host)

    // 无租户上下文只可能出现在 strict=false 且平台库同时挂了的极端情况。
    // 此时仍要给出可用的品牌与市场，否则前台会变成空白站。
    const [brand, features, markets, i18nOverrides] = tenant
      ? await Promise.all([
          getTenantBrand(env, tenant.id),
          getTenantFeatures(env, tenant.id),
          getTenantMarkets(tenant.id).catch(() => []),
          getTenantI18nOverrides(env, tenant.id),
        ])
      : [DEFAULT_BRAND, {}, [], {}]

    // 域名没配市场映射时（租户库的 site_domain 里没这条），单市场租户可以无歧义地推定；
    // 多市场租户不猜 —— 下发一个错币种比不下发严重得多，客户端还有自己的兜底逻辑。
    const current = markets.find((m) => m.market === market)
      ?? (markets.length === 1 ? markets[0] : undefined)
    ok(ctx, {
      domain: host.toLowerCase().replace(/^www\./, ''),
      market,
      tenant: tenant ? { code: tenant.code, status: tenant.status } : null,
      brand: {
        siteName: brand.siteName,
        shortName: brand.shortName,
        logoTextPrimary: brand.logoTextPrimary,
        logoTextAccent: brand.logoTextAccent,
        tagline: brand.tagline,
        logoLightUrl: brand.logoLightUrl,
        logoDarkUrl: brand.logoDarkUrl,
        faviconUrl: brand.faviconUrl,
        appIconUrl: brand.appIconUrl,
      },
      theme: brand.theme,
      features,
      i18nOverrides,
      currency: current?.currency ?? null,
      timezone: current?.timezone ?? null,
      markets: markets.map((m) => m.market),
    })
  })

  // Android 壳启动探活与线路配置。App 只接受 APK 内置白名单中的域名。
  api.get('/app/bootstrap', async (ctx) => {
    ctx.set('Cache-Control', 'no-store')
    const rawMarket = String(ctx.query.market ?? '').toUpperCase()
    const tenant = ctx.state.tenant
    // 市场白名单按租户开通的市场来，不再写死 PH/ID：租户 App 的 BuildConfig.APP_MARKET
    // 就是这里的取值，写死会让开在别的市场的客户包一启动就 400。
    // 无租户上下文（strict=false 且平台库同时挂了）时维持原来的 PH/ID
    const tenantMarkets = tenant ? await getTenantMarkets(tenant.id).catch(() => []) : []
    const allowed = tenantMarkets.length ? tenantMarkets.map((m) => m.market) : ['PH', 'ID']
    if (!allowed.includes(rawMarket)) {
      fail(ctx, 400, `market 必须是 ${allowed.join(' 或 ')}`); return
    }
    const market = rawMarket as SiteMarket
    const mappings = await getSiteDomainMappings(ctx.state.redis, ctx.state.env)
    // 配置异常（DB 降级、线路被清空）时绝不下发空表：App 收到空表会判定全部线路不可用而起不来。
    // 但兜底表是**自营站**的域名 —— 下发给客户租户等于把人家的用户送去别家站点，
    // 比冷启动失败严重得多。所以租户只用自己配的表，配空了就明确报错。
    const configured = appDomainsForMarket(mappings, market)
    const fallback = !tenant || tenant.selfOperated ? defaultAppDomainsForMarket(market) : []
    const usable = configured.length > 0 ? configured : fallback
    if (usable.length === 0) {
      fail(ctx, 503, `${market} 线路表未配置`); return
    }
    const domains = usable.map((item) => ({
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
  api.use(optMw, requireFeature('cs_ai'), csRoutes.routes(), csRoutes.allowedMethods())

  const protectedMw = authMiddleware()
  // rebate config 公开（无需登录），summary 需登录
  api.use(optMw, requireFeature('rebate'), rebateRoutes.routes(), rebateRoutes.allowedMethods())

  // 转盘：/status 游客可见（次数为 0），/draw /records 在 handler 内自查 userId
  api.use(optMw, requireFeature('spin'), spinRoutes.routes(), spinRoutes.allowedMethods())

  // P1-8：模块与功能开关一一对应的，直接挂在路由前缀上。
  // 前端隐藏入口不是安全边界 —— 关掉的模块必须在接口层也拒绝。
  // 钱包/账变/存提/注单不挂开关：它们是所有租户共有的资金链路，不属可关闭的定制化模块。
  const featureGated: ReadonlyArray<readonly [typeof userRoutes, Parameters<typeof requireFeature>[0]]> = [
    [kycRoutes, 'kyc'],
    [checkinRoutes, 'checkin'],
    [taskRoutes, 'task'],
    [teamRoutes, 'team_commission'],
    [agentRoutes, 'agent_center'],
    [vipRoutes, 'vip'],
  ]
  for (const [r, key] of featureGated) {
    api.use(protectedMw, requireFeature(key), r.routes(), r.allowedMethods())
  }

  for (const r of [
    userRoutes, walletRoutes, depositRoutes, withdrawRoutes,
    ledgerRoutes, promotionRoutes, yfpayRoutes, paymentUnifiedRoutes, betsRoutes, turnoverRoutes,
  ]) {
    api.use(protectedMw, r.routes(), r.allowedMethods())
  }

  return api
}
