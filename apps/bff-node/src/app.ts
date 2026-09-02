import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import type { Env } from './config/env.js'
import { getRedis } from './clients/redis.client.js'
import { errorHandler } from './middleware/errorHandler.js'
import { injectDeps, requestIdMiddleware } from './middleware/requestId.js'
import { accessLogMiddleware } from './middleware/accessLog.js'
import { rateLimitMiddleware } from './middleware/rateLimit.js'
import { tenantMiddleware } from './middleware/tenant.js'
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

export function createApp(env: Env): Koa {
  const app = new Koa()
  app.proxy = true  // 信任 nginx 的 X-Forwarded-For，ctx.ip 才能拿到真实用户 IP
  initStore(env)
  const redis = getRedis(env)
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
    const trySeed = (attempt: number): void => {
      seedDefaultAdmin(env).catch((err) => {
        if (attempt < 8) {
          const delay = Math.min(5_000 * (attempt + 1), 30_000)
          setTimeout(() => trySeed(attempt + 1), delay)
        } else {
          log.admin.error({ err }, 'seed failed')
        }
      })
    }
    setTimeout(() => trySeed(0), 10_000)
  }

  // 汇率定时刷新：启动后 30s 先跑一次，之后每 15 分钟。与 core-node 合计约 3600 次/月，给手动刷新留余量。
  if (singletonJobs) setTimeout(() => {
    refreshRates(redis, env).catch((err) => log.rates.error({ err }, 'refresh error'))
    setInterval(
      () => refreshRates(redis, env).catch((err) => log.rates.error({ err }, 'refresh error')),
      15 * 60 * 1000,
    )
  }, 30_000)

  // 支付服务商余额快照：启动后 60s 先刷一次，之后每 1 小时（用于与我方记账核对）
  if (singletonJobs && isMysqlEnabled(env)) {
    setTimeout(() => {
      const run = () => refreshBalances(env).catch((err) => log.payment.error({ err }, 'balance refresh error'))
      run()
      setInterval(run, 60 * 60 * 1000)
      const alert = () => notifyPendingPaymentCallbackIssues(env).catch((err) => log.payment.error({ err }, 'callback issue alert error'))
      alert()
      setInterval(alert, 60 * 1000)
    }, 60_000)
  }

  // 支付订单状态补偿：失败/过期回调可能缺失，定时把长时间 pending 的代收订单同步为终态。
  if (singletonJobs && isMysqlEnabled(env)) {
    setTimeout(() => {
      const run = () => runDepositStatusTick(env, log.depositStatus).catch((err) => log.depositStatus.error({ err }, 'deposit status tick error'))
      run()
      setInterval(run, 5 * 60 * 1000)
    }, 90_000)
  }

  // 洗码每日结算：菲律宾 UTC+8、印尼 UTC+7 分开切业务日。
  if (singletonJobs && isMysqlEnabled(env)) {
    const scheduleRebate = (utcHour: number, currencies: string[], timezoneOffsetHours: number) => {
      const run = () => runDailyRebateSettlement(env, yesterdayPHT(currencies[0]), { currencies, timezoneOffsetHours })
        .then(({ users, totalRebate }) => log.rebate.info({ users, totalRebate, timezoneOffsetHours }, 'rebate settlement done'))
        .catch((err) => log.rebate.error({ err, timezoneOffsetHours }, 'rebate settlement error'))
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
    const runNegRebate = async () => {
      try {
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
      } catch (err) {
        log.vip.error({ err }, 'daily loss rebate settlement error')
      }
    }
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
    const runVipDaily = async () => {
      try {
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
      } catch (err) {
        log.vip.error({ err }, 'vip daily maintenance error')
      }
    }
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

  // 社区营销自动发帖:每 30s tick(setInterval 长期漂移可能跳过整分,30s 步长+槽位 Redis 去重保证不漏不重)
  if (singletonJobs && isMysqlEnabled(env)) {
    const communityLog = childLogger('community-tick')
    setTimeout(() => {
      const run = () => runCommunityTick(env, redis).catch((err) => communityLog.error({ err }, 'tick error'))
      run()
      setInterval(run, 30_000)
    }, 15_000)
  }

  // TG 群发:每 30s 捡一个 sending 任务续发(Redis 锁防重入,cursor 断点续传,进程重启不丢进度)
  if (singletonJobs && isMysqlEnabled(env)) {
    const broadcastLog = childLogger('broadcast-tick')
    setTimeout(() => {
      const run = () => runBroadcastTick(env, redis).catch((err) => broadcastLog.error({ err }, 'tick error'))
      run()
      setInterval(run, 30_000)
    }, 20_000)
  }

  // BI 运营日报:每 5 分钟检查,马尼拉 10:00 时段发送(Redis 锁保证每天一次)
  if (singletonJobs && isMysqlEnabled(env)) {
    const biReportLog = childLogger('bi-report-tick')
    setTimeout(() => {
      const run = () => runBiReportTick(env, redis).catch((err) => biReportLog.error({ err }, 'tick error'))
      run()
      setInterval(run, 5 * 60 * 1000)
    }, 30_000)
  }

  // Betting activity 初始化（需要 games cache 已加载）
  const initBettingActivity = () =>
    Promise.all([
      refreshLatestPool(env),
      refreshRankTops(env),
    ]).catch((err) => log.betting.error({ err }, 'init error'))

  // 游戏缓存 + 首页推荐：启动 8s 后首次加载，失败则每 10s 重试，之后每 3 小时刷新首页推荐
  if (isMysqlEnabled(env)) {
    const loadWithRetry = (attempt = 0): void => {
      loadGamesCache(env)
        .then(() => refreshHomepageSelection(env))
        .then(() => initBettingActivity())
        .catch((err) => {
          log.games.error({ err, attempt }, 'load error')
          if (attempt < 12) setTimeout(() => loadWithRetry(attempt + 1), 10_000)
        })
    }
    setTimeout(() => loadWithRetry(), 8_000)

    // games cache 每 25 分钟刷新（TTL 30 分钟，提前续期避免 cache miss）
    setInterval(() => {
      loadGamesCache(env).catch((err) => log.games.error({ err }, 'cache refresh error'))
    }, 25 * 60 * 1000)

    setInterval(() => {
      refreshHomepageSelection(env).catch((err) => log.homepage.error({ err }, 'refresh error'))
    }, 3 * 60 * 60 * 1000)

    // Betting activity 定时刷新（真实数据）
    // latest: 每 60 秒拉最近真实注单，列表随投注持续滚动更新
    setInterval(() => {
      refreshLatestPool(env).catch((err) => log.betting.error({ err }, 'latest refresh error'))
    }, 60 * 1000)

    // week / month: 每 30 分钟重算滚动 7/30 天 Top10（bi_daily_game 小表聚合，成本可忽略）
    setInterval(() => {
      refreshRankTops(env).catch((err) => log.betting.error({ err }, 'rank refresh error'))
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
  app.use(injectDeps(env, redis))
  app.use(tenantMiddleware(env.TENANT_RESOLVE_STRICT))
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

  const api = createApiRouter()
  app.use(api.routes())
  app.use(api.allowedMethods())

  app.use(async (ctx) => {
    ctx.status = 404
    ctx.body = { code: 404, message: 'Not found', data: null, traceId: ctx.state.traceId }
  })

  return app
}
