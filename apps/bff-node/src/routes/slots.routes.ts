import Router from '@koa/router'
import { randomUUID } from 'node:crypto'
import { ok, fail } from '../utils/response.js'
import { listGames, listProviders, listThemes, getUserGameHistory, getHomepageSelection } from '../services/sg-game.service.js'
import { sgInitGame, sgInitDemo } from '../services/slotegrator.service.js'
import { getUser } from '../services/store/index.js'
import { isMysqlEnabled } from '../clients/mysql.client.js'
import { getBettingActivity, type BetTab } from '../services/betting-activity.service.js'

const router = new Router({ prefix: '/slots' })

// GET /slots/homepage — 首页推荐（服务器每 30 分钟刷新一次）
router.get('/homepage', async (ctx) => {
  const env = ctx.state.env
  if (!isMysqlEnabled(env)) {
    ok(ctx, { popular: [], slots: [], live: [], fishing: [], crash: [], table: [], generatedAt: '' })
    return
  }
  try {
    const selection = await getHomepageSelection(env)
    ok(ctx, selection ?? { popular: [], slots: [], live: [], fishing: [], crash: [], table: [], generatedAt: '' })
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'Failed to load homepage')
  }
})

// GET /slots/games — public game list from cache
// Also registered outside auth middleware in routes/index.ts
router.get('/games', async (ctx) => {
  const env = ctx.state.env
  if (!isMysqlEnabled(env)) {
    ok(ctx, { items: [], total: 0, page: 1, pages: 0 })
    return
  }
  const q = ctx.query as Record<string, string>
  try {
    const result = await listGames(env, {
      page: q.page ? Number(q.page) : 1,
      limit: q.limit ? Math.min(Number(q.limit), 100) : 30,
      search: q.search || undefined,
      provider: q.provider || undefined,
      category: q.category || undefined,
      sortCategory: q.sortCategory || undefined,
      sortBy: (q.sortBy as 'weight' | 'ph_bonus' | 'name') || undefined,
      themes: q.themes ? String(q.themes).split(',').filter(Boolean) : undefined,
      gameStyles: q.gameStyles ? String(q.gameStyles).split(',').filter(Boolean) : undefined,
      playerTypes: q.playerTypes ? String(q.playerTypes).split(',').filter(Boolean) : undefined,
    })
    ok(ctx, result)
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'Failed to list games')
  }
})

// GET /slots/betting-activity?tab=latest|week|month
router.get('/betting-activity', (ctx) => {
  const tab = (ctx.query.tab as string) || 'latest'
  if (tab !== 'latest' && tab !== 'week' && tab !== 'month') {
    fail(ctx, 400, 'Invalid tab')
    return
  }
  ok(ctx, getBettingActivity(tab as BetTab))
})

// GET /slots/themes — distinct themes from cache
router.get('/themes', async (ctx) => {
  const env = ctx.state.env
  if (!isMysqlEnabled(env)) {
    ok(ctx, [])
    return
  }
  try {
    const themes = await listThemes(env)
    ok(ctx, themes)
  } catch (e) {
    fail(ctx, 500, 'Failed to list themes')
  }
})

// GET /slots/providers?sortCategory=slots — distinct providers from cache
router.get('/providers', async (ctx) => {
  const env = ctx.state.env
  if (!isMysqlEnabled(env)) {
    ok(ctx, [])
    return
  }
  try {
    const sortCategory = (ctx.query.sortCategory as string) || undefined
    const providers = await listProviders(env, sortCategory)
    ok(ctx, providers)
  } catch (e) {
    fail(ctx, 500, 'Failed to list providers')
  }
})

// GET /slots/history — logged-in user's recently played games
router.get('/history', async (ctx) => {
  const env = ctx.state.env
  if (!ctx.state.userId) { ok(ctx, []); return }
  if (!isMysqlEnabled(env)) { ok(ctx, []); return }
  const limit = Math.min(Number(ctx.query.limit ?? 10), 20)
  try {
    const items = await getUserGameHistory(env, ctx.state.userId, limit)
    ok(ctx, items)
  } catch (e) {
    ok(ctx, [])
  }
})

// POST /slots/sync — 前台禁用，聚合商同步只能走 /admin/games/sync
router.post('/sync', async (ctx) => {
  fail(ctx, 403, 'Use admin game sync endpoint', 403)
})

// POST /slots/init — launch real-money game (requires auth)
router.post('/init', async (ctx) => {
  const env = ctx.state.env
  if (!ctx.state.userId) { fail(ctx, 401, 'Sign in to play'); return }
  const body = ctx.request.body as { gameUuid?: string; device?: string; language?: string; currency?: string }

  if (!body.gameUuid) {
    fail(ctx, 400, 'gameUuid is required')
    return
  }

  const userId = ctx.state.userId!
  const redis = ctx.state.redis
  const user = await getUser(redis, userId)
  if (!user) {
    fail(ctx, 401, 'User not found')
    return
  }

  if (body.gameUuid.startsWith('568win:')) {
    const parts = body.gameUuid.slice('568win:'.length).split(':')
    const gpId = parts.length > 1 ? Number(parts[0]) : undefined
    const gameId = Number(parts.length > 1 ? parts[1] : parts[0])
    if (!Number.isInteger(gameId) || (gpId !== undefined && !Number.isInteger(gpId))) {
      fail(ctx, 400, 'invalid 568Win game id')
      return
    }
    try {
      const res = await fetch(`${env.CORE_NODE_URL}/internal/win568/game/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': env.INTERNAL_TOKEN },
        body: JSON.stringify({
          userId,
          gpId,
          gameId,
          device: body.device === 'desktop' ? 'desktop' : 'mobile',
          language: body.language ?? user.locale ?? 'en',
        }),
      })
      const payload = await res.json() as { url?: string; error?: { id?: number; msg?: string }; message?: string }
      if (!res.ok || payload.error?.id) {
        fail(ctx, 502, payload.error?.msg || payload.message || 'Failed to launch 568Win game')
        return
      }
      if (!payload.url) {
        fail(ctx, 502, '568Win login URL missing')
        return
      }
      ok(ctx, { url: payload.url })
    } catch (e) {
      fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch 568Win game')
    }
    return
  }

  if (!env.SG_BASE_URL || !env.SG_MERCHANT_ID) {
    fail(ctx, 503, 'Game service temporarily unavailable')
    return
  }

  const sessionId = randomUUID()
  const VALID_WALLET_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TON', 'TRX', 'TRX_TESTNET', 'BNB', 'ETH', 'BTC', 'TLK_TESTNET']
  const rawCurrency = (body.currency ?? 'PHP').toUpperCase()
  const walletCurrency = VALID_WALLET_CURRENCIES.includes(rawCurrency) ? rawCurrency : 'PHP'
  // 单币种模式：SG 侧固定 EUR，回调按 session 映射到用户所选钱包币种（金额 1:1）
  const sessionPayload = env.SG_MULTI_CURRENCY
    ? userId
    : JSON.stringify({ uid: userId, wallet: walletCurrency })
  await redis.setex(`sg:session:${sessionId}`, 86400, sessionPayload)
  if (!env.SG_MULTI_CURRENCY) {
    await redis.setex(`sg:player:${userId}:wallet`, 86400, walletCurrency)
  }

  try {
    const result = await sgInitGame(
      {
        game_uuid: body.gameUuid,
        player_id: userId,
        player_name: user.displayName || userId,
        currency: env.SG_MULTI_CURRENCY ? walletCurrency : env.SG_CURRENCY,
        session_id: sessionId,
        return_url: env.SG_RETURN_URL,
        language: (body.language ?? user.locale ?? 'en').split('-')[0],
        device: (body.device === 'desktop' ? 'desktop' : 'mobile') as 'mobile' | 'desktop',
      },
      env,
    )
    ok(ctx, { url: result.url })
  } catch (e) {
    fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch game')
  }
})

// POST /slots/demo — demo mode, no auth required
router.post('/demo', async (ctx) => {
  const env = ctx.state.env
  const body = ctx.request.body as { gameUuid?: string; device?: string; language?: string }

  if (!body.gameUuid) {
    fail(ctx, 400, 'gameUuid is required')
    return
  }
  if (!env.SG_BASE_URL || !env.SG_MERCHANT_ID) {
    fail(ctx, 503, 'Game service temporarily unavailable')
    return
  }

  try {
    const result = await sgInitDemo(
      {
        game_uuid: body.gameUuid,
        currency: env.SG_CURRENCY,
        language: ((body.language ?? 'en') as string).split('-')[0],
        device: (body.device === 'desktop' ? 'desktop' : 'mobile') as 'mobile' | 'desktop',
        return_url: env.SG_RETURN_URL,
      },
      env,
    )
    ok(ctx, { url: result.url })
  } catch (e) {
    fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch demo')
  }
})

export default router
