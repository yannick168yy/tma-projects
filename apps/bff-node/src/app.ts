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
import { pollAndSettleTonDeposits } from './services/ton.service.js'
import { syncAllGames, loadGamesCache, refreshHomepageSelection } from './services/sg-game.service.js'
import { refreshLatestPool, refreshWeekTop, refreshMonthTop } from './services/betting-activity.service.js'
import { stripMobileNamesInDb } from './services/sg-game.service.js'
import { refreshRates } from './services/exchange-rate.service.js'
import { refreshBalances } from './services/payment-accounting.service.js'
import { runDailyRebateSettlement, yesterdayPHT } from './services/rebate.service.js'
import { isMysqlEnabled } from './clients/mysql.client.js'
import { ok } from './utils/response.js'
import { seedDefaultAdmin } from './services/admin-auth.service.js'

export function createApp(env: Env): Koa {
  const app = new Koa()
  app.proxy = true  // 信任 nginx 的 X-Forwarded-For，ctx.ip 才能拿到真实用户 IP
  initStore(env)
  const redis = getRedis(env)
  const log = {
    ton: childLogger('ton-poller'),
    admin: childLogger('admin-seed'),
    rates: childLogger('exchange-rate'),
    betting: childLogger('betting-activity'),
    games: childLogger('games-cache'),
    homepage: childLogger('homepage'),
    sgSync: childLogger('sg-sync'),
    rebate: childLogger('rebate-payout'),
    payment: childLogger('payment-balance'),
  }

  // TON deposit poller: every 30s
  setInterval(() => {
    pollAndSettleTonDeposits(redis, env).catch((err) =>
      log.ton.error({ err }, 'unhandled error'),
    )
  }, 30_000)

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

  // Betting activity 初始化（需要 games cache 已加载）
  const initBettingActivity = () =>
    Promise.all([
      refreshLatestPool(env),
      refreshWeekTop(env),
      refreshMonthTop(env),
    ]).catch((err) => log.betting.error({ err }, 'init error'))

  // 游戏缓存 + 首页推荐：启动 8s 后首次加载，失败则每 10s 重试，之后每 3 小时刷新首页推荐
  if (isMysqlEnabled(env)) {
    const loadWithRetry = (attempt = 0): void => {
      stripMobileNamesInDb(env)
        .then(() => loadGamesCache(env))
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

    // week / month: JS setInterval 上限约 24.8 天，用每天检查 + 时间戳守卫
    let weekLastAt = 0
    let monthLastAt = 0
    const WEEK_MS  = 7  * 24 * 60 * 60 * 1000
    const MONTH_MS = 30 * 24 * 60 * 60 * 1000
    setInterval(() => {
      const now = Date.now()
      if (now - weekLastAt >= WEEK_MS) {
        weekLastAt = now
        refreshWeekTop(env).catch((err) => log.betting.error({ err }, 'week refresh error'))
      }
      if (now - monthLastAt >= MONTH_MS) {
        monthLastAt = now
        refreshMonthTop(env).catch((err) => log.betting.error({ err }, 'month refresh error'))
      }
    }, 24 * 60 * 60 * 1000)
  }

  // Slotegrator game sync: on startup then every 24h，同步完自动刷新缓存和首页
  if (isMysqlEnabled(env) && env.SG_BASE_URL && env.SG_MERCHANT_ID) {
    const runSync = () =>
      syncAllGames(env)
        .then(({ synced }) => {
          log.sgSync.info({ synced }, 'synced games')
          return loadGamesCache(env)
        })
        .then(() => refreshHomepageSelection(env))
        .then(() => initBettingActivity())
        .catch((err) => {
          log.sgSync.error({ err }, 'sync error')
          // sg-sync 失败时仍尝试从缓存初始化 betting-activity
          initBettingActivity()
        })
    setInterval(runSync, 24 * 60 * 60 * 1000)
  }

  app.use(errorHandler())
  app.use(
    cors({
      origin: (ctx) => ctx.get('Origin') || '*',
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Init-Data', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id'],
    }),
  )
  app.use(requestIdMiddleware())
  app.use(injectDeps(env, redis))
  app.use(rateLimitMiddleware())
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
