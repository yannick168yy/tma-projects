import Router from '@koa/router'
import { creditWallet, getUser, listLedger, saveUser } from '../services/store.js'
import { formatDisplayTime, nowIso } from '../utils/format.js'
import { fail, ok } from '../utils/response.js'
import { getPromoConfig } from '../services/promo-config.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { createPromoRequirement } from '../services/turnover.service.js'

const PROMOS = [
  {
    promoId: 'trial',
    title: 'Trial Officer',
    subtitle: 'Get ₱88 free play',
    description: 'New users receive a trial red packet after Telegram login.',
    ctaLabel: 'Claim',
  },
  {
    promoId: 'referral',
    title: 'Referral Bonus',
    subtitle: 'Invite friends, earn rewards',
    description: 'Share your invite link. Rewards unlock when friends qualify.',
    ctaLabel: 'Copy Link',
  },
  {
    promoId: 'firstdep',
    title: 'First Deposit',
    subtitle: '120% bonus up to ₱1,000',
    description: 'First Telegram Wallet deposit earns up to ₱1,000 bonus.',
    ctaLabel: 'Deposit',
  },
] as const

const router = new Router({ prefix: '/promotions' })

function promoHighlights(user: Awaited<ReturnType<typeof getUser>>) {
  if (!user) return []
  return PROMOS.map((p) => {
    if (p.promoId === 'trial') {
      return { promoId: p.promoId, highlight: !user.trialClaimed, flagLabel: !user.trialClaimed ? '₱88' : null }
    }
    if (p.promoId === 'referral') {
      return {
        promoId: p.promoId,
        highlight: user.referralReady && !user.referralClaimed,
        flagLabel: user.referralReady && !user.referralClaimed ? 'Claim' : null,
      }
    }
    return {
      promoId: p.promoId,
      highlight: user.firstDepReady && !user.firstDepClaimed,
      flagLabel: user.firstDepReady && !user.firstDepClaimed ? '120%' : null,
    }
  })
}

router.get('/config', async (ctx) => {
  const cfg = await getPromoConfig(ctx.state.env)
  ok(ctx, cfg)
})

router.get('/', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  const highlights = promoHighlights(user)
  ok(
    ctx,
    PROMOS.map((p) => {
      const h = highlights.find((x) => x.promoId === p.promoId)
      return { ...p, highlight: h?.highlight ?? false, flagLabel: h?.flagLabel ?? null }
    }),
  )
})

router.get('/trial-play', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  const cfg = await getPromoConfig(ctx.state.env)
  const amount = cfg.trial.amount
  ok(ctx, {
    claimed: user.trialClaimed,
    amountPhp: amount,
    turnoverRequired: amount * 3,
    turnoverCompleted: user.trialClaimed ? amount : 0,
    canWithdraw: false,
  })
})

router.post('/trial-play/claim', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  if (user.trialClaimed) {
    fail(ctx, 409, 'Trial bonus already claimed')
    return
  }
  const cfg = await getPromoConfig(ctx.state.env)
  if (!cfg.trial.enabled) {
    fail(ctx, 409, 'Trial bonus is currently disabled')
    return
  }
  const amount = cfg.trial.amount
  user.trialClaimed = true
  await saveUser(ctx.state.redis, user)
  await creditWallet(ctx.state.redis, user.id, amount, {
    type: 'red_packet',
    description: 'Trial Officer red packet',
    createdAt: nowIso(),
    traceId: ctx.state.traceId,
  })
  if (cfg.trial.turnoverX > 0 && isMysqlEnabled(ctx.state.env)) {
    const expiresAt = cfg.trial.turnoverDays > 0
      ? new Date(Date.now() + cfg.trial.turnoverDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      : null
    await createPromoRequirement(getMysqlPool(ctx.state.env), user.id, 'trial', amount, cfg.trial.turnoverX, expiresAt)
  }
  ok(ctx, { amountPhp: amount, amountCents: amount })
})

router.get('/referral', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  const cfg = await getPromoConfig(ctx.state.env)
  const inviterAmt = cfg.referral.inviterAmount
  ok(ctx, {
    inviteCode: user.inviteCode,
    totalRewardPhp: user.referralClaimed ? inviterAmt : 0,
    pendingRewardPhp: user.referralReady && !user.referralClaimed ? inviterAmt : 0,
  })
})

router.get('/referral/link', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  const deepLink = `https://t.me/BetoGoBot/app?startapp=ref_${user.inviteCode}`
  ok(ctx, {
    deepLink,
    shareText: `Join BetoGo with my invite code ${user.inviteCode}! ${deepLink}`,
  })
})

router.get('/referral/records', async (ctx) => {
  const page = Number(ctx.query.page ?? 1)
  ok(ctx, {
    items: [
      { id: '1', role: 'inviter', displayName: 'J***o', status: 'qualified', rewardPhp: 50 },
    ],
    page,
  })
})

router.get('/red-packets', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  const ledger = await listLedger(ctx.state.redis, ctx.state.userId!, 50)
  const items = ledger
    .filter((e) => e.type === 'red_packet' || e.type === 'bonus')
    .map((e) => ({
      id: e.id,
      type: e.description,
      amountPhp: e.amount,
      createdAt: formatDisplayTime(e.createdAt),
    }))
  if (user?.trialClaimed && !items.length) {
    items.push({ id: 'rp_trial', type: 'Trial Officer', amountPhp: 88, createdAt: formatDisplayTime(nowIso()) })
  }
  ok(ctx, { items, page: Number(ctx.query.page ?? 1) })
})

router.get('/:promoId', async (ctx) => {
  const promo = PROMOS.find((p) => p.promoId === ctx.params.promoId)
  if (!promo) {
    fail(ctx, 404, 'Promotion not found', 404)
    return
  }
  ok(ctx, {
    ...promo,
    rules: promo.description,
    turnoverMultiplier: promo.promoId === 'firstdep' ? 3 : 1,
    maxBonusPhp: promo.promoId === 'firstdep' ? 1000 : 88,
  })
})

router.post('/:promoId/claim', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  if (!user) {
    fail(ctx, 404, 'User not found', 404)
    return
  }
  const promoId = ctx.params.promoId
  if (promoId === 'trial') {
    fail(ctx, 400, 'Use POST /promotions/trial-play/claim for trial bonus')
    return
  }
  if (promoId === 'referral') {
    if (!user.referralReady || user.referralClaimed) {
      fail(ctx, 409, 'Referral reward not available')
      return
    }
    const cfg = await getPromoConfig(ctx.state.env)
    if (!cfg.referral.enabled) { fail(ctx, 409, 'Referral bonus is currently disabled'); return }
    const amount = cfg.referral.inviterAmount
    user.referralClaimed = true
    user.referralReady = false
    await saveUser(ctx.state.redis, user)
    await creditWallet(ctx.state.redis, user.id, amount, {
      type: 'bonus',
      description: 'Referral bonus',
      createdAt: nowIso(),
      traceId: ctx.state.traceId,
    })
    if (cfg.referral.turnoverX > 0 && isMysqlEnabled(ctx.state.env)) {
      const expiresAt = cfg.referral.turnoverDays > 0
        ? new Date(Date.now() + cfg.referral.turnoverDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
        : null
      await createPromoRequirement(getMysqlPool(ctx.state.env), user.id, 'referral', amount, cfg.referral.turnoverX, expiresAt)
    }
    ok(ctx, { amountPhp: amount, amountCents: amount })
    return
  }
  if (promoId === 'firstdep') {
    if (!user.firstDepReady || user.firstDepClaimed) {
      fail(ctx, 409, 'First deposit bonus not available')
      return
    }
    const cfg = await getPromoConfig(ctx.state.env)
    if (!cfg.firstdep.enabled) { fail(ctx, 409, 'First deposit bonus is currently disabled'); return }
    const amount = cfg.firstdep.maxBonus
    user.firstDepClaimed = true
    user.firstDepReady = false
    await saveUser(ctx.state.redis, user)
    await creditWallet(ctx.state.redis, user.id, amount, {
      type: 'bonus',
      description: 'First deposit bonus',
      createdAt: nowIso(),
      traceId: ctx.state.traceId,
    })
    if (cfg.firstdep.turnoverX > 0 && isMysqlEnabled(ctx.state.env)) {
      const expiresAt = cfg.firstdep.turnoverDays > 0
        ? new Date(Date.now() + cfg.firstdep.turnoverDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
        : null
      await createPromoRequirement(getMysqlPool(ctx.state.env), user.id, 'firstdep', amount, cfg.firstdep.turnoverX, expiresAt)
    }
    ok(ctx, { amountPhp: amount, amountCents: amount })
    return
  }
  fail(ctx, 404, 'Promotion not found', 404)
})

export default router
