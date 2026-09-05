import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import type { Env } from './config/env.js'
import { getDefaultRedis, getRedis } from './clients/redis.client.js'
import { errorHandler } from './middleware/errorHandler.js'
import { injectDeps, requestIdMiddleware } from './middleware/requestId.js'
import { accessLogMiddleware } from './middleware/accessLog.js'
import { rateLimitMiddleware } from './middleware/rateLimit.js'
import { tenantMiddleware } from './middleware/tenant.js'
import { tenantGateMiddleware } from './middleware/tenant-gate.js'
import { runBillingSnapshot } from './services/billing/billing-daily.service.js'
import { runDunning } from './services/billing/dunning.service.js'
import { runPlatformBi } from './services/billing/platform-bi.service.js'
import { childLogger } from './lib/logger.js'
import { createApiRouter } from './routes/index.js'
import { initStore } from './services/store/index.js'
import { loadGamesCache, refreshHomepageSelection } from './services/sg-game.service.js'
import { refreshLatestPool, refreshRankTops } from './services/betting-activity.service.js'
import { refreshRates } from './services/exchange-rate.service.js'
import { notifyPendingPaymentCallbackIssues, refreshBalances } from './services/payment-accounting.service.js'
import { runDailyRebateSettlement, yesterdayPHT } from './services/rebate.service.js'
import {
  runDailyLossRebate, runWeeklySalary, runMonthlySalary,
  runBirthdayBonus, runQuarterlyRetention, ensureAndClimbVipStates,
} from './services/vip.service.js'
import { isMysqlEnabled, getMysqlPool } from './clients/mysql.client.js'
import { getLossRebateConfigByPool } from './services/promo-config.service.js'
import { runCommunityTick } from './services/community.service.js'
import { runBroadcastTick } from './services/broadcast.service.js'
import { runBiReportTick } from './services/bi-report.service.js'
import { runDepositStatusTick } from './services/deposit-status-sync.service.js'
import { ok } from './utils/response.js'
import { getMaintenanceMode } from './services/admin-store.js'
import { seedDefaultAdmin } from './services/admin-auth.service.js'
import { seedPlatformAdmin } from './services/platform-auth.service.js'
import { forEachTenant } from './services/tenant-jobs.js'

export function createApp(env: Env): Koa {
  const app = new Koa()
  app.proxy = true  // 信任 nginx 的 X-Forwarded-For，ctx.ip 才能拿到真实用户 IP
  initStore(env)
  // 启动期任务与租户中间件都跑在租户上下文之外，用无前缀客户端
  const redis = getDefaultRedis(env)
  const log = {
    admin: childLogger('admin-seed'),
    rates: childLogger('exchange-rate'),
    betting: childLogger('betting-activity'),
    games: childLogger('games-cache'),
    homepage: childLogger('homepage'),
    rebate: childLogger('rebate-payout'),
    vip: childLogger('vip-negative-rebate'),
    payment: childLogger('payment-balance'),
    depositStatus: childLogger('deposit-status'),
  }

  // 多实例部署:副实例(BFF_DISABLE_SINGLETON_JOBS=true)跳过"只能跑一份"的任务,
  // 防止结算/发奖类定时任务双跑重复入账;内存缓存类任务(games cache 等)每实例照常跑
  const singletonJobs = !env.BFF_DISABLE_SINGLETON_JOBS

  // Seed default admin account — retry with backoff until MySQL is reachable
  if (singletonJobs && isMysqlEnabled(env)) {
    // 重试放在租户回调内：forEachTenant 吞掉单租户异常以隔离故障，
    // 放外面会让第一次失败被当成成功，重试永远不触发
    // 平台管理员在平台库，不属于任何租户，不能放进 forEachTenant
    setTimeout(() => void seedPlatformAdmin().catch((err: unknown) =>
      log.admin.error({ err }, 'platform admin seed failed')), 12_000)

    setTimeout(() => void forEachTenant('seed-admin', async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await seedDefaultAdmin(env)
          return
        } catch (err) {
          if (attempt === 7) { log.admin.error({ err }, 'seed failed'); return }
          await new Promise((r) => setTimeout(r, Math.min(5_000 * (attempt + 1), 30_000)))
        }
      }
    }), 10_000)
  }

  // 汇率定时刷新：启动后 30s 先跑一次，之后每 15 分钟。与 core-node 合计约 3600 次/月，给手动刷新留余量。
  if (singletonJobs) setTimeout(() => {
    const runRates = () => forEachTenant('exchange-rate', () => refreshRates(getRedis(env), env))
      .catch((err) => log.rates.error({ err }, 'refresh error'))
    runRates()
    setInterval(runRates, 15 * 60 * 1000)
  }, 30_000)

  // 支付服务商余额快照：启动后 60s 先刷一次，之后每 1 小时（用于与我方记账核对）
  if (singletonJobs && isMysqlEnabled(env)) {
    setTimeout(() => {
      const run = () => forEachTenant('payment-balance', () => refreshBalances(env))
        .catch((err) => log.payment.error({ err }, 'balance refresh error'))
      run()
      setInterval(run, 60 * 60 * 1000)
      const alert = () => forEachTenant('payment-callback-alert', () => notifyPendingPaymentCallbackIssues(env))
        .catch((err) => log.payment.error({ err }, 'callback issue alert error'))
      alert()
      setInterval(alert, 60 * 1000)
    }, 60_000)
  }

  // 支付订单状态补偿：失败/过期回调可能缺失，定时把长时间 pending 的代收订单同步为终态。
  if (singletonJobs && isMysqlEnabled(env)) {
    setTimeout(() => {
      const run = () => forEachTenant('deposit-status', () => runDepositStatusTick(env, log.depositStatus))
        .catch((err) => log.depositStatus.error({ err }, 'deposit status tick error'))
      run()
      setInterval(run, 5 * 60 * 1000)
    }, 90_000)
  }

  // 洗码每日结算：菲律宾 UTC+8、印尼 UTC+7 分开切业务日。
  if (singletonJobs && isMysqlEnabled(env)) {
    const scheduleRebate = (utcHour: number, currencies: string[], timezoneOffsetHours: number) => {
      const run = () => forEachTenant(`rebate-utc${timezoneOffsetHours}`, async (tenant) => {
        const { users, totalRebate } = await runDailyRebateSettlement(env, yesterdayPHT(currencies[0]), { currencies, timezoneOffsetHours })
        log.rebate.info({ tenant: tenant.code, users, totalRebate, timezoneOffsetHours }, 'rebate settlement done')
      }).catch((err) => log.rebate.error({ err, timezoneOffsetHours }, 'rebate settlement error'))
      const now = new Date()
      const next = new Date()
      next.setUTCHours(utcHour, 0, 0, 0)
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
      setTimeout(() => { run(); setInterval(run, 24 * 60 * 60 * 1000) }, next.getTime() - now.getTime())
    }
    scheduleRebate(16, ['PHP', 'USDT', 'USDC'], 8)
    scheduleRebate(17, ['IDR'], 7)
  }

  // 负盈利返水（路线A）：每小时 :30 检查，PHT 到达配置的结算时刻（lossRebate.settleHour）时结算「昨天」整日
  //   活动关闭时内部 no-op；结算幂等（ON DUPLICATE KEY），同一小时多次触发安全；用户手动领取
  if (singletonJobs && isMysqlEnabled(env)) {
    const runNegRebate = () => forEachTenant('loss-rebate', async () => {
      const cfg = await getLossRebateConfigByPool(getMysqlPool(env))
      if (!cfg.enabled) return
      const phtHour = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours()
      const idHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours()
      if (phtHour === cfg.settleHour) {
        const result = await runDailyLossRebate(env, { currencies: ['PHP', 'USDT', 'USDC'], timezoneOffsetHours: 8 })
        log.vip.info({ ...result, timezone: 'UTC+8' }, 'daily loss rebate settled')
      }
      if (idHour === cfg.settleHour) {
        const result = await runDailyLossRebate(env, { currencies: ['IDR'], timezoneOffsetHours: 7 })
        log.vip.info({ ...result, timezone: 'UTC+7' }, 'daily loss rebate settled')
      }
    }).catch((err: unknown) => log.vip.error({ err }, 'daily loss rebate settlement error'))
    const msUntilNextHalfHour = () => {
      const now = new Date()
      const next = new Date(now)
      next.setUTCMinutes(30, 0, 0)
      if (next <= now) next.setUTCHours(next.getUTCHours() + 1)
      return next.getTime() - now.getTime()
    }
    setTimeout(() => {
      void runNegRebate()
      setInterval(() => void runNegRebate(), 60 * 60 * 1000)
    }, msUntilNextHalfHour())
  }

  // VIP 每日维护：每天 UTC 16:40（PHT 00:40）建行/爬升 + 周俸(周一)/月俸(1号)/生日/季度保级
  if (singletonJobs && isMysqlEnabled(env)) {
    const runVipDaily = () => forEachTenant('vip-daily', async () => {
      await ensureAndClimbVipStates(env)
      const pht = new Date(Date.now() + 8 * 60 * 60 * 1000)
      if (pht.getUTCDay() === 1) {
        const w = await runWeeklySalary(env)
        log.vip.info({ ...w }, 'weekly salary settled')
      }
      if (pht.getUTCDate() === 1) {
        const m = await runMonthlySalary(env)
        log.vip.info({ ...m }, 'monthly salary settled')
      }
      const bday = await runBirthdayBonus(env)
      if (bday.users > 0) log.vip.info({ ...bday }, 'birthday bonus granted')
      const ret = await runQuarterlyRetention(env)
      if (ret.processed > 0) log.vip.info({ ...ret }, 'quarterly retention processed')
    }).catch((err: unknown) => log.vip.error({ err }, 'vip daily maintenance error'))
    const msUntilVipDaily = () => {
      const now = new Date()
      const next = new Date()
      next.setUTCHours(16, 40, 0, 0)
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
      return next.getTime() - now.getTime()
    }
    setTimeout(() => {
      void runVipDaily()
      setInterval(() => void runVipDaily(), 24 * 60 * 60 * 1000)
    }, msUntilVipDaily())
  }

  // 计费日切 + 催收：每天 UTC 21:00（马尼拉 05:00）。
  // 必须晚于 core-node 的 BI 日聚合（马尼拉 04:00 补算前两天）—— 快照读的就是那份 bi_daily_*，
  // 抢在它前面跑会把还没补算完的数字锁进账单。
  if (singletonJobs && isMysqlEnabled(env)) {
    const billingLog = childLogger('billing-cron')
    const run = async () => {
      try {
        await runBillingSnapshot(env)
        await runPlatformBi(env)
        const actions = await runDunning(env)
        if (actions.length > 0) billingLog.warn({ actions }, '欠费降级已执行')
      } catch (err) {
        billingLog.error({ err }, 'billing snapshot / dunning failed')
      }
    }
    const msUntil = () => {
      const now = new Date()
      const next = new Date()
      next.setUTCHours(21, 0, 0, 0)
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
      return next.getTime() - now.getTime()
    }
    setTimeout(() => {
      void run()
      setInterval(() => void run(), 24 * 60 * 60 * 1000)
    }, msUntil())

    // 平台总览要能看到「今天到现在为止」，每 30 分钟只刷当天与昨天。
    // 回填前三天留给上面那轮日切 —— 高频轮次里做回填等于每半小时把所有租户库扫一遍
    setTimeout(() => {
      const light = () => runPlatformBi(env, [0, -1])
        .catch((err) => billingLog.error({ err }, 'platform bi refresh failed'))
      void light()
      setInterval(() => void light(), 30 * 60 * 1000)
    }, 60_000)
  }

  // 社区营销自动发帖:每 30s tick(setInterval 长期漂移可能跳过整分,30s 步长+槽位 Redis 去重保证不漏不重)
  if (singletonJobs && isMysqlEnabled(env)) {
    const communityLog = childLogger('community-tick')
    setTimeout(() => {
      const run = () => forEachTenant('community-tick', () => runCommunityTick(env, getRedis(env)))
        .catch((err) => communityLog.error({ err }, 'tick error'))
      run()
      setInterval(run, 30_000)
    }, 15_000)
  }

  // TG 群发:每 30s 捡一个 sending 任务续发(Redis 锁防重入,cursor 断点续传,进程重启不丢进度)
  if (singletonJobs && isMysqlEnabled(env)) {
    const broadcastLog = childLogger('broadcast-tick')
    setTimeout(() => {
      const run = () => forEachTenant('broadcast-tick', () => runBroadcastTick(env, getRedis(env)))
        .catch((err) => broadcastLog.error({ err }, 'tick error'))
      run()
      setInterval(run, 30_000)
    }, 20_000)
  }

  // BI 运营日报:每 5 分钟检查,马尼拉 10:00 时段发送(Redis 锁保证每天一次)
  if (singletonJobs && isMysqlEnabled(env)) {
    const biReportLog = childLogger('bi-report-tick')
    setTimeout(() => {
      const run = () => forEachTenant('bi-report-tick', () => runBiReportTick(env, getRedis(env)))
        .catch((err) => biReportLog.error({ err }, 'tick error'))
      run()
      setInterval(run, 5 * 60 * 1000)
    }, 30_000)
  }

  // Betting activity 初始化（需要 games cache 已加载）
  const initBettingActivity = () =>
    forEachTenant('betting-activity-init', async () => {
      await Promise.all([refreshLatestPool(env), refreshRankTops(env)])
    }).catch((err) => log.betting.error({ err }, 'init error'))

  // 游戏缓存 + 首页推荐：启动 8s 后首次加载，失败则每 10s 重试，之后每 3 小时刷新首页推荐
  if (isMysqlEnabled(env)) {
    // 同上：重试在租户回调内，单个租户加载失败不影响其他租户继续
    const loadAll = (): void => {
      void forEachTenant('games-cache-init', async () => {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          try {
            await loadGamesCache(env)
            await refreshHomepageSelection(env)
            return
          } catch (err) {
            log.games.error({ err, attempt }, 'load error')
            if (attempt === 11) throw err
            await new Promise((r) => setTimeout(r, 10_000))
          }
        }
      }).then(() => initBettingActivity())
    }
    setTimeout(loadAll, 8_000)

    // games cache 每 25 分钟刷新（TTL 30 分钟，提前续期避免 cache miss）
    setInterval(() => {
      forEachTenant('games-cache', () => loadGamesCache(env))
        .catch((err) => log.games.error({ err }, 'cache refresh error'))
    }, 25 * 60 * 1000)

    setInterval(() => {
      forEachTenant('homepage-selection', () => refreshHomepageSelection(env))
        .catch((err) => log.homepage.error({ err }, 'refresh error'))
    }, 3 * 60 * 60 * 1000)

    // Betting activity 定时刷新（真实数据）
    // latest: 每 60 秒拉最近真实注单，列表随投注持续滚动更新
    setInterval(() => {
      forEachTenant('betting-latest', () => refreshLatestPool(env))
        .catch((err) => log.betting.error({ err }, 'latest refresh error'))
    }, 60 * 1000)

    // week / month: 每 30 分钟重算滚动 7/30 天 Top10（bi_daily_game 小表聚合，成本可忽略）
    setInterval(() => {
      forEachTenant('betting-rank', () => refreshRankTops(env))
        .catch((err) => log.betting.error({ err }, 'rank refresh error'))
    }, 30 * 60 * 1000)
  }

  app.use(errorHandler())
  app.use(async (ctx, next) => {
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.set('X-Frame-Options', 'DENY')
    ctx.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    await next()
  })
  app.use(
    cors({
      // 鉴权全走 Bearer header 无 cookie，去掉 credentials 以免"反射任意 Origin+带凭证"组合
      origin: (ctx) => ctx.get('Origin') || '*',
      // 指纹三头(X-Device-Id/X-Fp-*)缺失会让跨源开发预览全量请求被 CORS 拦下(线上同源无感)
      allowHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Init-Data', 'X-Request-Id', 'X-Device-Id', 'X-Fp-Visitor', 'X-Fp-Signals', 'X-Attr'],
      exposeHeaders: ['X-Request-Id'],
    }),
  )
  app.use(requestIdMiddleware())
  // 顺序要紧：先定租户，injectDeps 才能把带 keyPrefix 的 Redis 客户端塞进 ctx.state
  app.use(tenantMiddleware(redis, env.TENANT_RESOLVE_STRICT))
  app.use(injectDeps(env))
  if (!env.BFF_DISABLE_RATE_LIMIT) app.use(rateLimitMiddleware())
  app.use(accessLogMiddleware())
  // banner/KYC 图以 base64 data URL 走 JSON 体，5MB 图 base64 后 ~6.7MB，限额需高于此，否则大图上传被 raw-body 拒绝并触发 nginx 504
  app.use(bodyParser({ jsonLimit: '10mb', formLimit: '10mb', textLimit: '10mb' }))

  app.use(async (ctx, next) => {
    if (ctx.path === '/health') {
      ok(ctx, { status: 'ok', service: 'bff-node' })
      return
    }
    await next()
  })

  // 全站维护模式：放行后台(/admin)与支付回调(/webhooks)，其余用户接口 503
  app.use(async (ctx, next) => {
    const p = ctx.path
    const exempt = !p.startsWith('/api/v1')
      || p.startsWith('/api/v1/admin')
      || p.startsWith('/api/v1/webhooks')
    if (!exempt && await getMaintenanceMode(ctx.state.redis, ctx.state.env)) {
      ctx.status = 503
      ctx.body = { code: 503, message: 'maintenance', data: null, traceId: ctx.state.traceId }
      return
    }
    await next()
  })

  // 欠费降级：停提现/停充值/停站的真正生效点（P2-10）
  app.use(tenantGateMiddleware())

  const api = createApiRouter()
  app.use(api.routes())
  app.use(api.allowedMethods())

  app.use(async (ctx) => {
    ctx.status = 404
    ctx.body = { code: 404, message: 'Not found', data: null, traceId: ctx.state.traceId }
  })

  return app
}
