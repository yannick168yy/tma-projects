import Router from '@koa/router'
import { ok, fail } from '../utils/response.js'
import {
  WIN568_SPORTSBOOK_UUID,
  EMPTY_HOMEPAGE_SELECTION,
  listGames,
  listProviders,
  getUserGameHistory,
  recordGameLaunch,
  getHomepageSelection,
  applyHomepageCurrency,
} from '../services/sg-game.service.js'
import { getUser } from '../services/store/index.js'
import { isMysqlEnabled } from '../clients/mysql.client.js'
import { getBettingActivity, type BetTab } from '../services/betting-activity.service.js'
import type { Env } from '../config/env.js'

const router = new Router({ prefix: '/slots' })

async function launchWin568GameUrl(input: {
  env: Env
  userId: string
  userLocale?: string
  gameUuid: string
  device?: string
  currency?: string
}) {
  const device = input.device === 'desktop' ? 'desktop' : 'mobile'
  const language = input.userLocale ?? 'en'

  if (input.gameUuid === WIN568_SPORTSBOOK_UUID) {
    const res = await fetch(`${input.env.CORE_NODE_URL}/internal/win568/sports/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': input.env.INTERNAL_TOKEN },
      body: JSON.stringify({ userId: input.userId, device, language, currency: input.currency }),
    })
    const payload = await res.json() as { url?: string; error?: { id?: number; msg?: string }; message?: string }
    if (!res.ok || payload.error?.id) throw new Error(payload.error?.msg || payload.message || 'Failed to launch 568Win Sports')
    if (!payload.url) throw new Error('568Win Sports login URL missing')
    return payload.url
  }

  const parts = input.gameUuid.slice('568win:'.length).split(':')
  const gpId = parts.length > 1 ? Number(parts[0]) : undefined
  const gameId = Number(parts.length > 1 ? parts[1] : parts[0])
  if (!Number.isInteger(gameId) || (gpId !== undefined && !Number.isInteger(gpId))) {
    throw new Error('invalid 568Win game id')
  }
  const res = await fetch(`${input.env.CORE_NODE_URL}/internal/win568/game/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': input.env.INTERNAL_TOKEN },
    body: JSON.stringify({ userId: input.userId, gpId, gameId, device, language, currency: input.currency }),
  })
  const payload = await res.json() as { url?: string; error?: { id?: number; msg?: string }; message?: string }
  if (!res.ok || payload.error?.id) throw new Error(payload.error?.msg || payload.message || 'Failed to launch 568Win game')
  if (!payload.url) throw new Error('568Win login URL missing')
  return payload.url
}

// GET /slots/homepage — 首页推荐（服务器每 30 分钟刷新一次）
router.get('/homepage', async (ctx) => {
  const env = ctx.state.env
  if (!isMysqlEnabled(env)) {
    ok(ctx, EMPTY_HOMEPAGE_SELECTION)
    return
  }
  try {
    const currency = typeof ctx.query.currency === 'string' ? ctx.query.currency : undefined
    const selection = await getHomepageSelection(env, currency)
    ok(ctx, selection ? applyHomepageCurrency(selection, currency) : EMPTY_HOMEPAGE_SELECTION)
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
      siteCategory: q.siteCategory || undefined,
      cashbackTier: q.cashbackTier || undefined,
      sortBy: (q.sortBy as 'weight' | 'name') || undefined,
      currency: q.currency || undefined,
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

// GET /slots/providers?sortCategory=slots — distinct providers from cache
router.get('/providers', async (ctx) => {
  const env = ctx.state.env
  if (!isMysqlEnabled(env)) {
    ok(ctx, [])
    return
  }
  try {
    const sortCategory = (ctx.query.sortCategory as string) || undefined
    const siteCategory = (ctx.query.siteCategory as string) || undefined
    const providers = await listProviders(env, sortCategory, siteCategory)
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

router.get('/win568-test-launch', async (ctx) => {
  const token = typeof ctx.query.token === 'string' ? ctx.query.token : ''
  const gameUuid = typeof ctx.query.gameUuid === 'string' ? ctx.query.gameUuid : ''
  if (!token || !gameUuid.startsWith('568win:')) {
    fail(ctx, 400, 'token and 568Win gameUuid are required')
    return
  }
  const userId = await ctx.state.redis.get(`slots:win568-test:${token}`)
  if (!userId) {
    fail(ctx, 401, 'Test link expired or invalid', 401)
    return
  }
  try {
    const url = await launchWin568GameUrl({
      env: ctx.state.env,
      userId,
      userLocale: 'en',
      gameUuid,
      device: typeof ctx.query.device === 'string' ? ctx.query.device : 'mobile',
    })
    ctx.redirect(url)
  } catch (e) {
    fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch 568Win game')
  }
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

  if (body.gameUuid === WIN568_SPORTSBOOK_UUID) {
    try {
      const url = await launchWin568GameUrl({ env, userId, userLocale: user.locale, gameUuid: body.gameUuid, device: body.device, currency: body.currency })
      void recordGameLaunch(env, userId, body.gameUuid)
      ok(ctx, { url })
    } catch (e) {
      fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch 568Win Sports')
    }
    return
  }

  if (body.gameUuid.startsWith('568win:')) {
    try {
      const url = await launchWin568GameUrl({ env, userId, userLocale: user.locale, gameUuid: body.gameUuid, device: body.device, currency: body.currency })
      void recordGameLaunch(env, userId, body.gameUuid)
      ok(ctx, { url })
    } catch (e) {
      fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch 568Win game')
    }
    return
  }

  fail(ctx, 400, 'Unknown game')
})

export default router
