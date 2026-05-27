import Router from '@koa/router'
import { listAdminGames, toggleAdminGame, writeAuditLog } from '../../services/admin-store.js'
import { ok, fail } from '../../utils/response.js'

const router = new Router({ prefix: '/games' })

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const provider = ctx.query.provider ? String(ctx.query.provider) : undefined
  const search = ctx.query.search ? String(ctx.query.search) : undefined
  const isActive = ctx.query.isActive !== undefined ? ctx.query.isActive === 'true' : undefined
  const result = await listAdminGames(ctx.state.env, { page, pageSize, provider, search, isActive })
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

export default router
