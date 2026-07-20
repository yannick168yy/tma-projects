import Router from '@koa/router'
import {
  getBiOverview, getBiTrends, getBiProviders, getBiGames, listBiAlerts, setBiAlertStatus,
} from '../../services/bi.service.js'
import { ok, fail } from '../../utils/response.js'

function parseCommon(q: Record<string, unknown>): { days: number; currency: string } | null {
  const days = Math.min(Math.max(Number(q.days) || 30, 7), 365)
  const currency = q.currency ? String(q.currency) : 'ALL'
  if (!/^[A-Z]{2,10}$/.test(currency) && currency !== 'ALL') return null
  return { days, currency }
}

const router = new Router({ prefix: '/bi' })

router.get('/overview', async (ctx) => {
  const data = await getBiOverview(ctx.state.env, ctx.state.redis)
  ok(ctx, data)
})

router.get('/trends', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 7), 365)
  const granularity = ['day', 'week', 'month'].includes(String(ctx.query.granularity))
    ? (String(ctx.query.granularity) as 'day' | 'week' | 'month')
    : 'day'
  const currency = ctx.query.currency ? String(ctx.query.currency) : 'ALL'
  if (!/^[A-Z]{2,10}$/.test(currency) && currency !== 'ALL') {
    fail(ctx, 400, 'invalid currency')
    return
  }
  const data = await getBiTrends(ctx.state.env, ctx.state.redis, { days, granularity, currency })
  ok(ctx, data)
})

router.get('/providers', async (ctx) => {
  const p = parseCommon(ctx.query)
  if (!p) { fail(ctx, 400, 'invalid currency'); return }
  const data = await getBiProviders(ctx.state.env, ctx.state.redis, p)
  ok(ctx, data)
})

router.get('/games', async (ctx) => {
  const p = parseCommon(ctx.query)
  if (!p) { fail(ctx, 400, 'invalid currency'); return }
  const limit = Math.min(Math.max(Number(ctx.query.limit) || 100, 10), 500)
  const data = await getBiGames(ctx.state.env, ctx.state.redis, { ...p, limit })
  ok(ctx, data)
})

router.get('/alerts', async (ctx) => {
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  if (status && !['open', 'ack', 'closed'].includes(status)) { fail(ctx, 400, 'invalid status'); return }
  ok(ctx, await listBiAlerts(ctx.state.env, status))
})

router.patch('/alerts/:id', async (ctx) => {
  const id = Number(ctx.params.id)
  const status = String((ctx.request.body as { status?: string })?.status ?? '')
  if (!id || !['ack', 'closed'].includes(status)) { fail(ctx, 400, 'invalid params'); return }
  const updated = await setBiAlertStatus(ctx.state.env, id, status as 'ack' | 'closed')
  ok(ctx, { updated })
})

export default router
