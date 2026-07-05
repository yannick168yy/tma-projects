import Router from '@koa/router'
import {
  writeAuditLog,
  listAdminWin568Games,
  toggleAdminWin568Game,
  updateAdminWin568Game,
  listWin568CoverCandidates,
  getWin568ProviderStats,
  toggleWin568ProviderGames,
  listHomepageSectionGames,
  replaceHomepageSectionGames,
  HOMEPAGE_SECTION_KEYS,
} from '../../services/admin-store.js'
import { loadGamesCache, refreshHomepageSelection, scheduleCacheRefresh, getGamesFromCache } from '../../services/sg-game.service.js'
import {
  createJob,
  getJob,
  getActiveJobForType,
  updateJobProgress,
  completeJob,
  failJob,
} from '../../services/admin-job.service.js'
import { isMysqlEnabled } from '../../clients/mysql.client.js'
import { getRedis } from '../../clients/redis.client.js'
import type { Env } from '../../config/env.js'
import { ok, fail } from '../../utils/response.js'

const router = new Router({ prefix: '/games' })

router.get('/jobs/:jobId', async (ctx) => {
  const job = await getJob(getRedis(ctx.state.env), ctx.params.jobId)
  if (!job) {
    fail(ctx, 404, 'Job not found')
    return
  }
  ok(ctx, job)
})

router.get('/win568', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const providerValue = ctx.query.provider
  const result = await listAdminWin568Games(ctx.state.env, {
    page,
    pageSize,
    provider: Array.isArray(providerValue) ? providerValue.map(String) : providerValue ? String(providerValue).split(',').filter(Boolean) : undefined,
    search: ctx.query.search ? String(ctx.query.search) : undefined,
    isActive: ctx.query.isActive !== undefined ? ctx.query.isActive === 'true' : undefined,
    upstreamAvailable: ctx.query.upstreamAvailable !== undefined ? ctx.query.upstreamAvailable === 'true' : undefined,
    sortCategory: ctx.query.sortCategory ? String(ctx.query.sortCategory) : undefined,
    siteCategory: ctx.query.siteCategory ? String(ctx.query.siteCategory) : undefined,
    newGameType: ctx.query.newGameType !== undefined ? Number(ctx.query.newGameType) : undefined,
    currency: ctx.query.currency ? String(ctx.query.currency) : undefined,
    device: ctx.query.device ? String(ctx.query.device) : undefined,
    isFeatured: ctx.query.isFeatured !== undefined ? ctx.query.isFeatured === 'true' : undefined,
    coverStatus: ctx.query.coverStatus ? String(ctx.query.coverStatus) : undefined,
    sortField: ctx.query.sortField ? String(ctx.query.sortField) : undefined,
    sortOrder: ctx.query.sortOrder === 'asc' || ctx.query.sortOrder === 'desc' ? ctx.query.sortOrder : undefined,
  })
  ok(ctx, result)
})

router.patch('/win568/:gameProviderId/:gameId/toggle', async (ctx) => {
  const body = ctx.request.body as { isActive?: boolean }
  const gameProviderId = Number(ctx.params.gameProviderId)
  const gameId = Number(ctx.params.gameId)
  if (!Number.isInteger(gameProviderId) || !Number.isInteger(gameId) || typeof body.isActive !== 'boolean') {
    fail(ctx, 400, 'gameProviderId, gameId and isActive are required'); return
  }
  await toggleAdminWin568Game(ctx.state.env, gameProviderId, gameId, body.isActive)
  scheduleCacheRefresh(ctx.state.env)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: body.isActive ? 'win568.game.enable' : 'win568.game.disable',
    targetType: 'win568_game',
    targetId: `${gameProviderId}:${gameId}`,
    ip: ctx.ip,
  })
  ok(ctx, { gameProviderId, gameId, isActive: body.isActive })
})

router.patch('/win568/:gameProviderId/:gameId', async (ctx) => {
  const body = ctx.request.body as {
    isActive?: boolean | null
    weight?: number | null
    isFeatured?: boolean | null
    sortCategory?: string | null
    siteCategory?: string | null
    nameOverride?: string | null
    imageOverride?: string | null
    imageOverrideSource?: string | null
    imageAnim?: string | null
  }
  const gameProviderId = Number(ctx.params.gameProviderId)
  const gameId = Number(ctx.params.gameId)
  if (!Number.isInteger(gameProviderId) || !Number.isInteger(gameId)) {
    fail(ctx, 400, 'gameProviderId and gameId are required'); return
  }
  if (body.weight !== undefined && body.weight !== null && (!Number.isInteger(Number(body.weight)) || Number(body.weight) < 0 || Number(body.weight) > 10000)) {
    fail(ctx, 400, 'weight must be 0-10000'); return
  }
  await updateAdminWin568Game(ctx.state.env, gameProviderId, gameId, {
    isActive: body.isActive,
    weight: body.weight === undefined || body.weight === null ? body.weight : Number(body.weight),
    isFeatured: body.isFeatured,
    // undefined=未传保留原值，''/null=显式清空。不能写 `x || null`：会把未传字段清掉
    sortCategory: body.sortCategory === undefined ? undefined : (body.sortCategory || null),
    siteCategory: body.siteCategory === undefined ? undefined : (body.siteCategory || null),
    nameOverride: body.nameOverride === undefined ? undefined : (body.nameOverride || null),
    imageOverride: body.imageOverride === undefined ? undefined : (body.imageOverride || null),
    imageOverrideSource: body.imageOverrideSource === undefined ? undefined : (body.imageOverrideSource || null),
    imageAnim: body.imageAnim === undefined ? undefined : (body.imageAnim || null),
  })
  scheduleCacheRefresh(ctx.state.env)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'win568.game.update',
    targetType: 'win568_game',
    targetId: `${gameProviderId}:${gameId}`,
    detail: body,
    ip: ctx.ip,
  })
  ok(ctx, { gameProviderId, gameId })
})

router.get('/win568/:gameProviderId/:gameId/cover-candidates', async (ctx) => {
  const gameProviderId = Number(ctx.params.gameProviderId)
  const gameId = Number(ctx.params.gameId)
  if (!Number.isInteger(gameProviderId) || !Number.isInteger(gameId)) {
    fail(ctx, 400, 'gameProviderId and gameId are required'); return
  }
  ok(ctx, await listWin568CoverCandidates(ctx.state.env, gameProviderId, gameId))
})

router.get('/win568-provider-stats', async (ctx) => {
  try {
    ok(ctx, await getWin568ProviderStats(ctx.state.env))
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'Failed')
  }
})

router.post('/win568-provider-toggle', async (ctx) => {
  const body = ctx.request.body as { provider?: string; isActive?: boolean }
  if (!body.provider || typeof body.isActive !== 'boolean') {
    fail(ctx, 400, 'provider and isActive required'); return
  }
  const affected = await toggleWin568ProviderGames(ctx.state.env, body.provider, body.isActive)
  scheduleCacheRefresh(ctx.state.env)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: body.isActive ? 'win568.provider.enable' : 'win568.provider.disable',
    targetType: 'win568_provider',
    targetId: body.provider,
    ip: ctx.ip,
  })
  ok(ctx, { provider: body.provider, isActive: body.isActive, affected })
})

async function runWin568SyncJob(
  env: Env,
  jobId: string,
  adminId: number,
  adminUsername: string,
  ip?: string,
) {
  const redis = getRedis(env)
  try {
    await updateJobProgress(redis, jobId, { status: 'running', message: '正在从 568Win 拉取游戏…' })
    const res = await fetch(`${env.CORE_NODE_URL}/internal/win568/games/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': env.INTERNAL_TOKEN },
      body: '{}',
    })
    const payload = await res.json() as { error?: { id?: number; msg?: string }; syncedCount?: number }
    if (!res.ok || payload.error?.id) throw new Error(payload.error?.msg || '568Win sync failed')
    await updateJobProgress(redis, jobId, { progress: payload.syncedCount ?? 0, total: payload.syncedCount ?? 0, message: '刷新缓存与首页…' })
    await loadGamesCache(env)
    await refreshHomepageSelection(env)
    await writeAuditLog(env, {
      adminId,
      adminUsername,
      action: 'win568.game.sync',
      targetType: 'game',
      targetId: '568win',
      ip,
    })
    await completeJob(redis, jobId, { synced: payload.syncedCount ?? 0 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '568Win sync failed'
    console.error('[win568-games-sync-job]', msg, e)
    await failJob(redis, jobId, msg)
  }
}

router.post('/win568-sync', async (ctx) => {
  const env = ctx.state.env
  if (!isMysqlEnabled(env)) {
    fail(ctx, 400, 'MySQL not configured'); return
  }
  const redis = getRedis(env)
  const active = await getActiveJobForType(redis, 'win568_games_sync')
  if (active) {
    ok(ctx, { jobId: active.id, alreadyRunning: true })
    return
  }
  const job = await createJob(redis, 'win568_games_sync')
  ok(ctx, { jobId: job.id })
  void runWin568SyncJob(env, job.id, ctx.state.adminId!, ctx.state.adminUsername!, String(ctx.ip ?? ''))
})

router.post('/refresh-cache', async (ctx) => {
  try {
    const count = await loadGamesCache(ctx.state.env)
    await refreshHomepageSelection(ctx.state.env)
    ok(ctx, { cached: count })
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'Refresh failed')
  }
})

router.post('/refresh-homepage', async (ctx) => {
  try {
    await refreshHomepageSelection(ctx.state.env)
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'Refresh failed')
  }
})

// 首页板块手动干预：当前各板块 pin/exclude 配置（附游戏名/图，取自 games 缓存）
router.get('/homepage-sections', async (ctx) => {
  try {
    const [rows, games] = await Promise.all([
      listHomepageSectionGames(ctx.state.env),
      getGamesFromCache(ctx.state.env),
    ])
    const byUuid = new Map(games.map((g) => [g.uuid, g]))
    const sections: Record<string, unknown[]> = {}
    for (const key of HOMEPAGE_SECTION_KEYS) sections[key] = []
    for (const r of rows) {
      const g = byUuid.get(r.gameUuid)
      ;(sections[r.sectionKey] ??= []).push({
        ...r,
        name: g?.name ?? null,
        provider: g?.provider ?? null,
        imageUrl: g?.imageUrl ?? null,
        siteCategory: g?.siteCategory ?? null,
      })
    }
    ok(ctx, { sectionKeys: HOMEPAGE_SECTION_KEYS, sections })
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'Failed')
  }
})

// 整体替换某板块(某币种)的 pin/exclude 列表，立即重建首页选品
router.put('/homepage-sections/:sectionKey', async (ctx) => {
  try {
    const sectionKey = ctx.params.sectionKey
    const body = ctx.request.body as {
      currency?: string
      items?: { gameUuid: string; action: 'pin' | 'exclude'; pinPosition: number | null }[]
    }
    const items = Array.isArray(body.items) ? body.items : []
    await replaceHomepageSectionGames(ctx.state.env, sectionKey, body.currency ?? '', items)
    await refreshHomepageSelection(ctx.state.env)
    await writeAuditLog(ctx.state.env, {
      adminId: ctx.state.adminId!,
      adminUsername: ctx.state.adminUsername!,
      action: 'game.homepage.section.update',
      targetType: 'homepage_section',
      targetId: `${sectionKey}:${body.currency ?? ''}`,
      ip: ctx.ip,
    })
    ok(ctx, { ok: true })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : 'Failed')
  }
})

export default router
