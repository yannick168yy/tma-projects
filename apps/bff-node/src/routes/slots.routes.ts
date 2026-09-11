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
  isGameAvailable,
} from '../services/sg-game.service.js'
import { getUser } from '../services/store/index.js'
import { isMysqlEnabled } from '../clients/mysql.client.js'
import { getBettingActivity, type BetTab } from '../services/betting-activity.service.js'
import type { Env } from '../config/env.js'
import { getTenantFeatures } from '../services/tenant-feature.service.js'
import { resolveGameRoute } from '../services/game-routing.service.js'

const router = new Router({ prefix: '/slots' })

/**
 * 游戏品类开关 → 游戏库里的 sortCategory 取值。
 * 'table'（棋牌）与 'lottery' 目前没有对应的 sortCategory 数据，故不在此表 ——
 * 宁可少管一个品类，也不要凭空造一个匹配不到任何游戏的映射假装管住了。
 */
const CATEGORY_FEATURE: ReadonlyArray<readonly [string, 'slots' | 'live' | 'sports' | 'fishing']> = [
  ['slots', 'slots'], ['live', 'live'], ['sports', 'sports'], ['fishing', 'fishing'],
]

/** 该租户关掉的游戏品类。无租户上下文时不屏蔽任何品类 */
async function blockedCategories(ctx: import('koa').Context): Promise<string[]> {
  const tenant = ctx.state.tenant
  if (!tenant) return []
  const features = await getTenantFeatures(ctx.state.env, tenant.id)
  return CATEGORY_FEATURE.filter(([, key]) => features[key] === false).map(([cat]) => cat)
}

/**
 * core-node 内部接口的租户前缀。
 *
 * core-node 从 URL 里的 :tenantCode 解析归属，不看 Host。不带租户段时它会回落自营站
 * 并打警告——包网租户的玩家起游戏会落到自营站的库上，拿错人的账号和余额。
 * 自营站返回空串，路径与改造前逐字相同，所以现有流量行为不变。
 */
function tenantPrefix(ctx: import('koa').Context): string {
  const tenant = ctx.state.tenant
  return !tenant || tenant.selfOperated ? '' : `/t/${tenant.code}`
}

async function launchWin568GameUrl(input: {
  env: Env
  userId: string
  userLocale?: string
  gameUuid: string
  device?: string
  currency?: string
  prefix: string
}) {
  const device = input.device === 'desktop' ? 'desktop' : 'mobile'
  const language = input.userLocale ?? 'en'

  if (input.gameUuid === WIN568_SPORTSBOOK_UUID) {
    const res = await fetch(`${input.env.CORE_NODE_URL}${input.prefix}/internal/win568/sports/launch`, {
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
  const res = await fetch(`${input.env.CORE_NODE_URL}${input.prefix}/internal/win568/game/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': input.env.INTERNAL_TOKEN },
    body: JSON.stringify({ userId: input.userId, gpId, gameId, device, language, currency: input.currency }),
  })
  const payload = await res.json() as { url?: string; error?: { id?: number; msg?: string }; message?: string }
  if (!res.ok || payload.error?.id) throw new Error(payload.error?.msg || payload.message || 'Failed to launch 568Win game')
  if (!payload.url) throw new Error('568Win login URL missing')
  return payload.url
}

// uuid 形如 wxgame:<brand>:<gameId>。不能 split(':')：上游 gameId 自身含冒号
// （如 TombstoneSlaughter:ElGordo'sRevenge），split 会切出不存在的 id。
function parseWxgameUuid(uuid: string): { gameBrand: string; gameId: string } | null {
  const first = uuid.indexOf(':')
  if (first < 0 || uuid.slice(0, first) !== 'wxgame') return null
  const second = uuid.indexOf(':', first + 1)
  if (second < 0) return null
  const gameBrand = uuid.slice(first + 1, second)
  const gameId = uuid.slice(second + 1)
  return gameBrand && gameId ? { gameBrand, gameId } : null
}

async function launchWxgameGameUrl(input: {
  env: Env
  userId: string
  userLocale?: string
  gameUuid: string
  currency?: string
  prefix: string
}) {
  const ref = parseWxgameUuid(input.gameUuid)
  if (!ref) throw new Error('invalid WXGame game uuid')
  const res = await fetch(`${input.env.CORE_NODE_URL}${input.prefix}/internal/wxgame/game/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': input.env.INTERNAL_TOKEN },
    body: JSON.stringify({
      userId: input.userId, gameBrand: ref.gameBrand, gameId: ref.gameId,
      language: input.userLocale, currency: input.currency,
    }),
  })
  const payload = await res.json() as { url?: string; error?: string }
  if (!res.ok || !payload.url) throw new Error(payload.error || 'Failed to launch WXGame game')
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
  const blocked = await blockedCategories(ctx)
  // 明确点名了被关掉的品类：403 而不是静默返回空列表 ——
  // 空列表看起来像「暂无游戏」，会让人以为是数据问题而不是没开通
  if (q.sortCategory && q.sortCategory !== 'all') {
    const asked = q.sortCategory.split(',').map((v) => v.trim()).filter(Boolean)
    if (asked.length > 0 && asked.every((v) => blocked.includes(v))) {
      fail(ctx, 403, '该功能未开通')
      return
    }
  }
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
      rtpMin: q.rtpMin ? Number(q.rtpMin) : undefined,
      sortBy: (q.sortBy as 'weight' | 'name') || undefined,
      currency: q.currency || undefined,
      blockedSortCategories: blocked,
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
  const currency = String(ctx.query.currency ?? 'PHP').toUpperCase() === 'IDR' ? 'IDR' : 'PHP'
  ok(ctx, getBettingActivity(tab as BetTab, currency))
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
    const rtpMin = ctx.query.rtpMin ? Number(ctx.query.rtpMin) : undefined
    const currency = (ctx.query.currency as string) || undefined
    const providers = await listProviders(env, sortCategory, siteCategory, rtpMin, currency)
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
      prefix: tenantPrefix(ctx),
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

  let canonicalUuid = body.gameUuid
  let managed = false
  try {
    const resolved = await resolveGameRoute(env, body.gameUuid, body.currency, body.device)
    body.gameUuid = resolved.uuid
    canonicalUuid = resolved.canonicalUuid
    managed = resolved.managed
  } catch (e) {
    fail(ctx, 409, e instanceof Error ? e.message : 'Game unavailable')
    return
  }
  if (!managed && !(await isGameAvailable(env, body.gameUuid))) {
    fail(ctx, 409, 'This game is under maintenance')
    return
  }

  if (body.gameUuid === WIN568_SPORTSBOOK_UUID) {
    try {
      const url = await launchWin568GameUrl({ env, userId, userLocale: user.locale, gameUuid: body.gameUuid, device: body.device, currency: body.currency, prefix: tenantPrefix(ctx) })
      void recordGameLaunch(env, userId, canonicalUuid)
      ok(ctx, { url })
    } catch (e) {
      fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch 568Win Sports')
    }
    return
  }

  if (body.gameUuid.startsWith('wxgame:')) {
    try {
      const url = await launchWxgameGameUrl({ env, userId, userLocale: user.locale, gameUuid: body.gameUuid, currency: body.currency, prefix: tenantPrefix(ctx) })
      void recordGameLaunch(env, userId, canonicalUuid)
      ok(ctx, { url })
    } catch (e) {
      fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch WXGame game')
    }
    return
  }

  if (body.gameUuid.startsWith('568win:')) {
    try {
      const url = await launchWin568GameUrl({ env, userId, userLocale: user.locale, gameUuid: body.gameUuid, device: body.device, currency: body.currency, prefix: tenantPrefix(ctx) })
      void recordGameLaunch(env, userId, canonicalUuid)
      ok(ctx, { url })
    } catch (e) {
      fail(ctx, 502, e instanceof Error ? e.message : 'Failed to launch 568Win game')
    }
    return
  }

  fail(ctx, 400, 'Unknown game')
})

export default router
