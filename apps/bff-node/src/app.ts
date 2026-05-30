import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import type { Env } from './config/env.js'
import { getRedis } from './clients/redis.client.js'
import { errorHandler } from './middleware/errorHandler.js'
import { injectDeps, requestIdMiddleware } from './middleware/requestId.js'
import { createApiRouter } from './routes/index.js'
import { initStore } from './services/store/index.js'
import { pollAndSettleTonDeposits } from './services/ton.service.js'
import { syncAllGames, loadGamesCache, refreshHomepageSelection } from './services/sg-game.service.js'
import { refreshRates } from './services/exchange-rate.service.js'
import { runDailyReconciliation, yesterday } from './services/sg-settlement.service.js'
import { isMysqlEnabled } from './clients/mysql.client.js'
import { ok } from './utils/response.js'
import { seedDefaultAdmin } from './services/admin-auth.service.js'

export function createApp(env: Env): Koa {
  const app = new Koa()
  app.proxy = true  // 信任 nginx 的 X-Forwarded-For，ctx.ip 才能拿到真实用户 IP
  initStore(env)
  const redis = getRedis(env)

  // TON deposit poller: every 30s
  setInterval(() => {
    pollAndSettleTonDeposits(redis, env).catch((err) =>
      console.error('[ton-poller] unhandled error:', err),
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
          console.error('[admin-seed] error:', err)
        }
      })
    }
    setTimeout(() => trySeed(0), 10_000)
  }

  // 汇率定时刷新：启动后 30s 先跑一次，之后每 10 分钟刷新
  // EUR/USD 走 API（2次/10min × 6 × 24 × 30 = 8640次/月 < 5000免费额度）
  // USDT/TON 直接用 env 兜底，不消耗 API 配额
  setTimeout(() => {
    refreshRates(redis, env).catch((err) => console.error('[exchange-rate] refresh error:', err))
    setInterval(
      () => refreshRates(redis, env).catch((err) => console.error('[exchange-rate] refresh error:', err)),
      10 * 60 * 1000,
    )
  }, 30_000)

  // SG 日结算对账：每天 UTC 02:05（新加坡时间 10:05）跑昨日数据
  if (isMysqlEnabled(env) && env.SG_BASE_URL && env.SG_MERCHANT_ID) {
    const runReconcile = () =>
      runDailyReconciliation(env, yesterday()).catch((err) =>
        console.error('[sg-settlement] error:', err),
      )
    const msUntilNext = () => {
      const now = new Date()
      const next = new Date()
      next.setUTCHours(2, 5, 0, 0)
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
      return next.getTime() - now.getTime()
    }
    setTimeout(() => {
      runReconcile()
      setInterval(runReconcile, 24 * 60 * 60 * 1000)
    }, msUntilNext())
  }

  // 游戏缓存 + 首页推荐：启动 8s 后首次加载，之后每 3 小时刷新首页推荐
  if (isMysqlEnabled(env)) {
    setTimeout(() => {
      loadGamesCache(env)
        .then(() => refreshHomepageSelection(env))
        .catch((err) => console.error('[games-cache] load error:', err))
    }, 8_000)

    setInterval(() => {
      refreshHomepageSelection(env).catch((err) => console.error('[homepage] refresh error:', err))
    }, 3 * 60 * 60 * 1000)
  }

  // Slotegrator game sync: on startup then every 24h，同步完自动刷新缓存和首页
  if (isMysqlEnabled(env) && env.SG_BASE_URL && env.SG_MERCHANT_ID) {
    const runSync = () =>
      syncAllGames(env)
        .then(({ synced }) => {
          console.log(`[sg-sync] synced ${synced} games`)
          return loadGamesCache(env)
        })
        .then(() => refreshHomepageSelection(env))
        .catch((err) => console.error('[sg-sync] error:', err))
    setTimeout(runSync, 10_000)
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
  app.use(bodyParser())
  app.use(requestIdMiddleware())
  app.use(injectDeps(env, redis))

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
