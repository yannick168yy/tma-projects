import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import type { Env } from './config/env.js'
import { getRedis } from './clients/redis.client.js'
import { errorHandler } from './middleware/errorHandler.js'
import { injectDeps, requestIdMiddleware } from './middleware/requestId.js'
import { accessLogMiddleware } from './middleware/accessLog.js'
import { rateLimitMiddleware } from './middleware/rateLimit.js'
import { childLogger } from './lib/logger.js'
import { createApiRouter } from './routes/index.js'
import { initStore } from './services/store/index.js'
import { loadGamesCache, refreshHomepageSelection } from './services/sg-game.service.js'
import { refreshLatestPool, refreshRankTops } from './services/betting-activity.service.js'
import { refreshRates } from './services/exchange-rate.service.js'
import { refreshBalances } from './services/payment-accounting.service.js'
import { runDailyRebateSettlement, yesterdayPHT } from './services/rebate.service.js'
import {
  runDailyLossRebate, runWeeklySalary, runMonthlySalary,
  runBirthdayBonus, runQuarterlyRetention, ensureAndClimbVipStates,
} from './services/vip.service.js'
import { isMysqlEnabled, getMysqlPool } from './clients/mysql.client.js'
import { getLossRebateConfigByPool } from './services/promo-config.service.js'
import { ok } from './utils/response.js'
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
  }

  // Seed default admin account — retry with backoff until MySQL is reachable
  if (isMysqlEnabled(env)) {
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

  // 汇率定时刷新：启动后 30s 先跑一次，之后每 10 分钟（全部走 CoinGecko）
  setTimeout(() => {
    refreshRates(redis, env).catch((err) => log.rates.error({ err }, 'refresh error'))
    setInterval(
      () => refreshRates(redis, env).catch((err) => log.rates.error({ err }, 'refresh error')),
      10 * 60 * 1000,
    )
  }, 30_000)

  // 支付服务商余额快照：启动后 60s 先刷一次，之后每 1 小时（用于与我方记账核对）
  if (isMysqlEnabled(env)) {
    setTimeout(() => {
      const run = () => refreshBalances(env).catch((err) => log.payment.error({ err }, 'balance refresh error'))
      run()
      setInterval(run, 60 * 60 * 1000)
    }, 60_000)
  }

  // 洗码每日结算：每天 UTC 16:00（PHT 00:00 凌晨）结算昨日流水写入待领取记录（不自动入账，用户手动领取）
  if (isMysqlEnabled(env)) {
    const runRebate = () =>
      runDailyRebateSettlement(env, yesterdayPHT())
        .then(({ users, totalRebate }) =>
          log.rebate.info({ users, totalRebate }, 'rebate settlement done'),
        )
        .catch((err) => log.rebate.error({ err }, 'rebate settlement error'))
    const msUntilRebate = () => {
      const now = new Date()
      const next = new Date()
      next.setUTCHours(16, 0, 0, 0)
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
      return next.getTime() - now.getTime()
    }
    setTimeout(() => {
      runRebate()
      setInterval(runRebate, 24 * 60 * 60 * 1000)
    }, msUntilRebate())
  }

  // 负盈利返水（路线A）：每小时 :30 检查，PHT 到达配置的结算时刻（lossRebate.settleHour）时结算「昨天」整日
  //   活动关闭时内部 no-op；结算幂等（ON DUPLICATE KEY），同一小时多次触发安全；用户手动领取
  if (isMysqlEnabled(env)) {
    const runNegRebate = async () => {
      try {
        const cfg = await getLossRebateConfigByPool(getMysqlPool(env))
        if (!cfg.enabled) return
        const phtHour = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours()
        if (phtHour !== cfg.settleHour) return
        const { periodKey, users, totalAmount, skipped } = await runDailyLossRebate(env)
        log.vip.info({ periodKey, users, totalAmount, skipped }, 'daily loss rebate settled')
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
  if (isMysqlEnabled(env)) {
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

    // Betting activity 定时刷新
    // latest: 每 20 分钟
    setInterval(() => {
      refreshLatestPool(env).catch((err) => log.betting.error({ err }, 'latest refresh error'))
    }, 20 * 60 * 1000)

    // week / month 一起刷新以保持关联（同一批游戏）；每 7 天一次，用每天检查 + 时间戳守卫
    let rankLastAt = 0
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    setInterval(() => {
      const now = Date.now()
      if (now - rankLastAt >= WEEK_MS) {
        rankLastAt = now
        refreshRankTops(env).catch((err) => log.betting.error({ err }, 'rank refresh error'))
      }
    }, 24 * 60 * 60 * 1000)
  }

  app.use(errorHandler())
  app.use(
    cors({
      // 鉴权全走 Bearer header 无 cookie，去掉 credentials 以免"反射任意 Origin+带凭证"组合
      origin: (ctx) => ctx.get('Origin') || '*',
      // 指纹三头(X-Device-Id/X-Fp-*)缺失会让跨源开发预览全量请求被 CORS 拦下(线上同源无感)
      allowHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Init-Data', 'X-Request-Id', 'X-Device-Id', 'X-Fp-Visitor', 'X-Fp-Signals'],
      exposeHeaders: ['X-Request-Id'],
    }),
  )
  app.use(requestIdMiddleware())
  app.use(injectDeps(env, redis))
  if (!env.BFF_DISABLE_RATE_LIMIT) app.use(rateLimitMiddleware())
  app.use(accessLogMiddleware())
  app.use(bodyParser({ jsonLimit: '2mb', formLimit: '2mb', textLimit: '2mb' }))

  app.use(async (ctx, next) => {
    if (ctx.path === '/health') {
      ok(ctx, { status: 'ok', service: 'bff-node' })
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
