import Router from '@koa/router'
import { getPromoConfig, savePromoConfig, type PromoConfig } from '../../services/promo-config.service.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/promotions' })

router.get('/config', async (ctx) => {
  const config = await getPromoConfig(ctx.state.env)
  ok(ctx, config)
})

router.put('/config', async (ctx) => {
  const body = ctx.request.body as Partial<PromoConfig>

  const current = await getPromoConfig(ctx.state.env)
  const updated: PromoConfig = {
    trial:    { ...current.trial,    ...(body.trial    ?? {}) },
    referral: { ...current.referral, ...(body.referral ?? {}) },
    firstdep: { ...current.firstdep, ...(body.firstdep ?? {}) },
  }

  // 简单校验
  if (updated.trial.amount <= 0 || updated.trial.amount > 50000) {
    fail(ctx, 400, 'trial.amount 必须在 1-50000 之间'); return
  }
  if (updated.referral.inviterAmount < 0 || updated.referral.inviteeAmount < 0) {
    fail(ctx, 400, 'referral 金额不能为负数'); return
  }
  if (updated.firstdep.matchPct <= 0 || updated.firstdep.matchPct > 1000) {
    fail(ctx, 400, 'firstdep.matchPct 必须在 1-1000 之间'); return
  }
  if (updated.firstdep.maxBonus <= 0 || updated.firstdep.minDeposit <= 0 || updated.firstdep.turnoverX <= 0) {
    fail(ctx, 400, 'firstdep 金额/流水倍率必须大于 0'); return
  }

  await savePromoConfig(ctx.state.env, updated)
  ok(ctx, updated)
})

export default router
