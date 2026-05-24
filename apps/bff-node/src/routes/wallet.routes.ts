import Router from '@koa/router'
import { getWallet } from '../services/store.js'
import { formatPhp } from '../utils/format.js'
import { ok } from '../utils/response.js'

const TURNOVER_MULTIPLIER = 3

const router = new Router({ prefix: '/wallet' })

router.get('/balances', async (ctx) => {
  const wallet = await getWallet(ctx.state.redis, ctx.state.userId!)
  ok(ctx, [{ currency: 'PHP', available: wallet.available, frozen: wallet.frozen }])
})

router.get('/summary', async (ctx) => {
  const wallet = await getWallet(ctx.state.redis, ctx.state.userId!)
  ok(ctx, {
    primaryCurrency: 'PHP',
    displayPhp: formatPhp(wallet.available),
    balances: [{ currency: 'PHP', available: wallet.available, frozen: wallet.frozen }],
    frozenNote: wallet.frozen > 0 ? 'Some funds are frozen pending turnover.' : null,
  })
})

router.get('/turnover', async (ctx) => {
  const wallet = await getWallet(ctx.state.redis, ctx.state.userId!)
  const required = wallet.available * TURNOVER_MULTIPLIER
  const completed = Math.min(required, wallet.available)
  ok(ctx, {
    currency: 'PHP',
    multiplier: TURNOVER_MULTIPLIER,
    required,
    completed,
    canWithdraw: completed >= required || wallet.available === 0,
  })
})

export default router
