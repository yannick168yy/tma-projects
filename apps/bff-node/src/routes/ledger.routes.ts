import Router from '@koa/router'
import { getLedgerEntry, listLedger } from '../services/store.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/ledger' })

router.get('/', async (ctx) => {
  const page = Number(ctx.query.page ?? 1)
  const type = String(ctx.query.type ?? 'all')
  const limit = 50
  let items = await listLedger(ctx.state.redis, ctx.state.userId!, limit)
  if (type !== 'all') {
    items = items.filter((e) => e.type === type)
  }
  const start = (page - 1) * 20
  ok(ctx, {
    items: items.slice(start, start + 20).map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      balanceAfter: e.balanceAfter,
      description: e.description,
      createdAt: e.createdAt,
    })),
    page,
  })
})

router.get('/:id', async (ctx) => {
  const entry = await getLedgerEntry(ctx.state.redis, ctx.state.userId!, ctx.params.id)
  if (!entry) {
    fail(ctx, 404, 'Ledger entry not found', 404)
    return
  }
  ok(ctx, entry)
})

export default router
