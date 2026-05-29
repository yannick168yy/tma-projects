import Router from '@koa/router'
import { listAdminGames, toggleAdminGame, writeAuditLog } from '../../services/admin-store.js'
import { syncAllGames } from '../../services/sg-game.service.js'
import { isMysqlEnabled } from '../../clients/mysql.client.js'
import { ok, fail } from '../../utils/response.js'

const router = new Router({ prefix: '/games' })

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const provider = ctx.query.provider ? String(ctx.query.provider) : undefined
  const search = ctx.query.search ? String(ctx.query.search) : undefined
  const isActive = ctx.query.isActive !== undefined ? ctx.query.isActive === 'true' : undefined
  const type = ctx.query.type ? String(ctx.query.type) : undefined
  const sortCategory = ctx.query.sortCategory ? String(ctx.query.sortCategory) : undefined
  const volatility = ctx.query.volatility ? String(ctx.query.volatility) : undefined
  const isFeatured = ctx.query.isFeatured !== undefined ? ctx.query.isFeatured === 'true' : undefined
  const hasDemo = ctx.query.hasDemo !== undefined ? ctx.query.hasDemo === 'true' : undefined
  const theme = ctx.query.theme ? String(ctx.query.theme) : undefined
  const gameStyle = ctx.query.gameStyle ? String(ctx.query.gameStyle) : undefined
  const playerType = ctx.query.playerType ? String(ctx.query.playerType) : undefined
  const weightMin = ctx.query.weightMin !== undefined ? Number(ctx.query.weightMin) : undefined
  const weightMax = ctx.query.weightMax !== undefined ? Number(ctx.query.weightMax) : undefined
  const result = await listAdminGames(ctx.state.env, {
    page, pageSize, provider, search, isActive, type, sortCategory, volatility,
    isFeatured, hasDemo, theme, gameStyle, playerType, weightMin, weightMax,
  })
  ok(ctx, result)
})

router.patch('/:uuid/toggle', async (ctx) => {
  const body = ctx.request.body as { isActive?: boolean }
  if (typeof body.isActive !== 'boolean') {
    fail(ctx, 400, 'isActive must be boolean'); return
  }
  await toggleAdminGame(ctx.state.env, ctx.params.uuid, body.isActive)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: body.isActive ? 'game.enable' : 'game.disable',
    targetType: 'game',
    targetId: ctx.params.uuid,
    ip: ctx.ip,
  })
  ok(ctx, { uuid: ctx.params.uuid, isActive: body.isActive })
})

router.post('/sync', async (ctx) => {
  const env = ctx.state.env
  if (!isMysqlEnabled(env) || !env.SG_BASE_URL) {
    fail(ctx, 400, 'Slotegrator not configured'); return
  }
  try {
    const result = await syncAllGames(env)
    await writeAuditLog(env, {
      adminId: ctx.state.adminId!,
      adminUsername: ctx.state.adminUsername!,
      action: 'game.sync',
      targetType: 'game',
      targetId: 'all',
      ip: ctx.ip,
    })
    ok(ctx, result)
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : 'Sync failed')
  }
})

export default router
