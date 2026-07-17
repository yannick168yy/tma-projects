import Router from '@koa/router'
import {
  getHomeContent,
  deleteHomeContentItem,
  saveHomeContentItem,
  storeHomeImage,
  type HomeContentActionType,
  type HomeContentKind,
} from '../../services/home-content.service.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/home-content' })

const actionTypes = new Set<HomeContentActionType>(['promo', 'cashback', 'spin', 'lobby', 'none', 'path', 'url'])
const kinds = new Set<HomeContentKind>(['banner', 'wallet_banner'])

function validKind(value: unknown): value is HomeContentKind {
  return typeof value === 'string' && kinds.has(value as HomeContentKind)
}

function validActionType(value: unknown): value is HomeContentActionType {
  return typeof value === 'string' && actionTypes.has(value as HomeContentActionType)
}

router.get('/', async (ctx) => {
  ok(ctx, await getHomeContent(ctx.state.env, true))
})

router.post('/upload', async (ctx) => {
  const body = (ctx.request.body ?? {}) as { kind?: unknown; imageData?: unknown }
  if (!validKind(body.kind)) {
    fail(ctx, 400, 'kind 必须是 banner 或 wallet_banner')
    return
  }
  if (typeof body.imageData !== 'string') {
    fail(ctx, 400, 'imageData is required')
    return
  }
  try {
    ok(ctx, await storeHomeImage(ctx.state.env, body.kind, body.imageData))
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '上传失败')
  }
})

router.put('/item', async (ctx) => {
  const body = (ctx.request.body ?? {}) as {
    kind?: unknown
    slot?: unknown
    imageKey?: unknown
    actionType?: unknown
    actionValue?: unknown
    enabled?: unknown
  }
  if (!validKind(body.kind)) {
    fail(ctx, 400, 'kind 必须是 banner 或 wallet_banner')
    return
  }
  const slot = Number(body.slot)
  if (!Number.isInteger(slot) || slot < 1 || slot > 20) {
    fail(ctx, 400, 'slot 必须是 1-20 的整数')
    return
  }
  if (typeof body.imageKey !== 'string' || !body.imageKey.startsWith('home/')) {
    fail(ctx, 400, 'imageKey 无效')
    return
  }
  if (!validActionType(body.actionType)) {
    fail(ctx, 400, 'actionType 无效')
    return
  }
  ok(ctx, await saveHomeContentItem(ctx.state.env, {
    kind: body.kind,
    slot,
    imageKey: body.imageKey,
    actionType: body.actionType,
    actionValue: typeof body.actionValue === 'string' && body.actionValue ? body.actionValue : null,
    enabled: body.enabled !== false,
  }))
})

router.delete('/item/:kind/:slot', async (ctx) => {
  if (!validKind(ctx.params.kind)) {
    fail(ctx, 400, 'kind 必须是 banner 或 wallet_banner')
    return
  }
  const slot = Number(ctx.params.slot)
  if (!Number.isInteger(slot) || slot < 1 || slot > 20) {
    fail(ctx, 400, 'slot 必须是 1-20 的整数')
    return
  }
  await deleteHomeContentItem(ctx.state.env, ctx.params.kind, slot)
  ok(ctx, { ok: true })
})

export default router
