import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import {
  getLevelConfig,
  saveLevelConfig,
  getLevelThresholds,
  saveLevelThresholds,
  MAX_LEVEL,
  getFeaturedGames,
  addFeaturedGame,
  removeFeaturedGame,
  runDailyRebateSettlement,
  todayPHT,
} from '../../services/rebate.service.js'
import { getGamesFromCache, loadGamesCache } from '../../services/sg-game.service.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import type { RowDataPacket } from 'mysql2/promise'

const router = new Router({ prefix: '/rebate' })

function formatDateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function formatDateTime(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19)
  return String(value).replace('T', ' ').slice(0, 19)
}

// GET /admin/rebate/config — 分级费率矩阵 + 等级流水阈值
router.get('/config', async (ctx) => {
  const [config, thresholds] = await Promise.all([
    getLevelConfig(ctx.state.env),
    getLevelThresholds(ctx.state.env),
  ])
  ok(ctx, { config, thresholds })
})

// PUT /admin/rebate/config — 保存分级费率矩阵
router.put('/config', async (ctx) => {
  const body = ctx.request.body as {
    config?: { level: number; gameCategory: string; ratePct: number; maxBonus: number; enabled: boolean }[]
  }
  if (!Array.isArray(body.config) || body.config.length === 0) {
    fail(ctx, 400, 'config array required')
    return
  }
  for (const item of body.config) {
    if (!Number.isInteger(item.level) || item.level < 1 || item.level > MAX_LEVEL) {
      fail(ctx, 400, `invalid level ${item.level}`)
      return
    }
    if (typeof item.gameCategory !== 'string' || typeof item.ratePct !== 'number') {
      fail(ctx, 400, 'invalid config item')
      return
    }
    if (item.ratePct < 0 || item.ratePct > 100) {
      fail(ctx, 400, `rate_pct out of range for L${item.level}/${item.gameCategory}`)
      return
    }
    if (item.maxBonus != null && (typeof item.maxBonus !== 'number' || item.maxBonus < 0)) {
      fail(ctx, 400, `invalid max_bonus for L${item.level}/${item.gameCategory}`)
      return
    }
  }
  await saveLevelConfig(ctx.state.env, body.config)
  ok(ctx, { saved: body.config.length })
})

// PUT /admin/rebate/thresholds — 保存等级流水阈值（LV1 固定 0，服务层忽略）
router.put('/thresholds', async (ctx) => {
  const body = ctx.request.body as { thresholds?: { level: number; minTurnover: number }[] }
  if (!Array.isArray(body.thresholds) || body.thresholds.length === 0) {
    fail(ctx, 400, 'thresholds array required')
    return
  }
  for (const item of body.thresholds) {
    if (!Number.isInteger(item.level) || item.level < 1 || item.level > MAX_LEVEL) {
      fail(ctx, 400, `invalid level ${item.level}`)
      return
    }
    if (typeof item.minTurnover !== 'number' || item.minTurnover < 0) {
      fail(ctx, 400, `invalid min_turnover for L${item.level}`)
      return
    }
  }
  await saveLevelThresholds(ctx.state.env, body.thresholds)
  ok(ctx, { saved: body.thresholds.length })
})

// GET /admin/rebate/featured-games
router.get('/featured-games', async (ctx) => {
  const games = await getFeaturedGames(ctx.state.env)
  ok(ctx, { games })
})

// POST /admin/rebate/featured-games
router.post('/featured-games', async (ctx) => {
  const body = ctx.request.body as { gameUuid?: string; tier?: string; sortOrder?: number }
  if (!body.gameUuid) { fail(ctx, 400, 'gameUuid required'); return }
  const tier = body.tier ?? 'elite'
  if (tier !== 'elite' && tier !== 'pro') { fail(ctx, 400, 'tier must be elite or pro'); return }

  if (!isMysqlEnabled(ctx.state.env)) { fail(ctx, 503, 'DB not available'); return }

  // 验证 game_uuid 是否存在（游戏目录缓存 = 568win 全量）
  const games = await getGamesFromCache(ctx.state.env)
  const game = games.find((g) => g.uuid === body.gameUuid)
  if (!game) { fail(ctx, 404, 'Game not found'); return }

  await addFeaturedGame(ctx.state.env, body.gameUuid, tier, body.sortOrder ?? 0)
  await loadGamesCache(ctx.state.env) // 精选档位烘在游戏缓存里(cashbackTier 角标)，改完即时重建
  ok(ctx, { gameUuid: body.gameUuid, tier, name: game.name })
})

// DELETE /admin/rebate/featured-games/:id
router.delete('/featured-games/:id', async (ctx) => {
  const id = Number(ctx.params.id)
  if (!id) { fail(ctx, 400, 'invalid id'); return }
  await removeFeaturedGame(ctx.state.env, id)
  await loadGamesCache(ctx.state.env)
  ok(ctx, { deleted: id })
})

// POST /admin/rebate/payout/manual — 手动结算截至当前时间的洗码记录
router.post('/payout/manual', async (ctx) => {
  const date = todayPHT()
  const result = await runDailyRebateSettlement(ctx.state.env, date)
  ok(ctx, { date, ...result })
})

// GET /admin/rebate/records — 洗码派发记录列表（管理后台查看）
router.get('/records', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [], total: 0 }); return }
  const pool = getMysqlPool(ctx.state.env)
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(1000, Math.max(1, Number(ctx.query.pageSize ?? 50)))
  const dateFilter = ctx.query.date ? String(ctx.query.date) : undefined
  const userFilter = ctx.query.userId ? String(ctx.query.userId) : undefined

  const where: string[] = []
  const params: unknown[] = []
  if (dateFilter) { where.push('rr.date = ?'); params.push(dateFilter) }
  if (userFilter) { where.push('rr.user_id = ?'); params.push(userFilter) }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [[{ total }]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_rebate_record rr ${whereClause}`,
    params,
  )
  const [items] = await pool.query<RowDataPacket[]>(
    `SELECT rr.id, rr.user_id, u.display_name, rr.date, rr.game_category,
            rr.currency_code, rr.bet_amount, rr.rebate_amount, rr.rate_pct,
            rr.status, rr.paid_at
     FROM bg_rebate_record rr
     LEFT JOIN bg_user u ON u.id = rr.user_id
     ${whereClause}
     ORDER BY rr.date DESC, rr.paid_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  ok(ctx, {
    items: items.map((r) => ({
      id: Number(r.id),
      userId: String(r.user_id),
      displayName: r.display_name ? String(r.display_name) : null,
      date: formatDateOnly(r.date),
      gameCategory: String(r.game_category),
      currencyCode: String(r.currency_code),
      betAmount: Number(r.bet_amount),
      rebateAmount: Number(r.rebate_amount),
      ratePct: Number(r.rate_pct),
      status: String(r.status),
      paidAt: formatDateTime(r.paid_at),
    })),
    total: Number(total),
    page,
    pageSize,
  })
})

export default router
