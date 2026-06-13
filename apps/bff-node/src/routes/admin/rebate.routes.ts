import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import {
  getRebateConfig,
  saveRebateConfig,
  getFeaturedGames,
  addFeaturedGame,
  removeFeaturedGame,
  runDailyRebatePayout,
  yesterdayPHT,
} from '../../services/rebate.service.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import type { RowDataPacket } from 'mysql2/promise'

const router = new Router({ prefix: '/rebate' })

// GET /admin/rebate/config
router.get('/config', async (ctx) => {
  const config = await getRebateConfig(ctx.state.env)
  ok(ctx, { config })
})

// PUT /admin/rebate/config
router.put('/config', async (ctx) => {
  const body = ctx.request.body as {
    config?: { gameCategory: string; ratePct: number; enabled: boolean }[]
  }
  if (!Array.isArray(body.config) || body.config.length === 0) {
    fail(ctx, 400, 'config array required')
    return
  }
  for (const item of body.config) {
    if (typeof item.gameCategory !== 'string' || typeof item.ratePct !== 'number') {
      fail(ctx, 400, 'invalid config item')
      return
    }
    if (item.ratePct < 0 || item.ratePct > 100) {
      fail(ctx, 400, `rate_pct out of range for ${item.gameCategory}`)
      return
    }
  }
  await saveRebateConfig(ctx.state.env, body.config)
  ok(ctx, { saved: body.config.length })
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

  // 验证 game_uuid 是否存在
  const pool = getMysqlPool(ctx.state.env)
  const [[game]] = await pool.query<RowDataPacket[]>(
    'SELECT uuid, name, provider FROM sg_games WHERE uuid = ?',
    [body.gameUuid],
  )
  if (!game) { fail(ctx, 404, 'Game not found'); return }

  await addFeaturedGame(ctx.state.env, body.gameUuid, tier, body.sortOrder ?? 0)
  ok(ctx, { gameUuid: body.gameUuid, tier, name: game.name })
})

// DELETE /admin/rebate/featured-games/:id
router.delete('/featured-games/:id', async (ctx) => {
  const id = Number(ctx.params.id)
  if (!id) { fail(ctx, 400, 'invalid id'); return }
  await removeFeaturedGame(ctx.state.env, id)
  ok(ctx, { deleted: id })
})

// POST /admin/rebate/payout/manual — 手动触发指定日期的洗码派发（补跑或测试用）
router.post('/payout/manual', async (ctx) => {
  const body = ctx.request.body as { date?: string }
  const date = body.date ?? yesterdayPHT()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(ctx, 400, 'invalid date, expected YYYY-MM-DD')
    return
  }
  const result = await runDailyRebatePayout(ctx.state.env, date)
  ok(ctx, { date, ...result })
})

// GET /admin/rebate/records — 洗码派发记录列表（管理后台查看）
router.get('/records', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [], total: 0 }); return }
  const pool = getMysqlPool(ctx.state.env)
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize ?? 50)))
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
  ok(ctx, { items, total: Number(total), page, pageSize })
})

export default router
