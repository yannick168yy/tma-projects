import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
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
    subtitle: 'Bonus on your first top-up',
    description: 'Your first deposit auto-earns a bonus based on the amount you top up.',
    ctaLabel: 'Deposit',
  },
] as const

const router = new Router({ prefix: '/promotions' })

async function withUserPromoLock<T>(
  ctx: import('koa').Context,
  userId: string,
  promoId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (typeof ctx.state.redis?.set !== 'function') return fn()
  const key = `promo:claim:lock:${userId}:${promoId}`
  const val = `${Date.now()}:${Math.random()}`
  const locked = await ctx.state.redis.set(key, val, 'EX', 10, 'NX')
  if (!locked) throw new Error('errors.duplicateRequest')
  try {
    return await fn()
  } finally {
    const current = typeof ctx.state.redis.get === 'function'
      ? await ctx.state.redis.get(key)
      : null
    if (current === val && typeof ctx.state.redis.del === 'function') await ctx.state.redis.del(key)
  }
}

async function hasFirstDeposit(env: Env, user: Awaited<ReturnType<typeof getUser>>) {
  if (!user) return false
  if (!isMysqlEnabled(env)) return Boolean(user.firstDepClaimed || user.firstDepReady)
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    "SELECT 1 FROM bg_deposit_order WHERE user_id = ? AND status = 'paid' LIMIT 1",
    [user.id],
  )
  return rows.length > 0
}

function promoHighlights(user: Awaited<ReturnType<typeof getUser>>, firstDepositDone: boolean) {
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
    return { promoId: p.promoId, highlight: !firstDepositDone, flagLabel: !firstDepositDone ? 'Deposit' : null }
  })
}

// GET /promotions/config 已移至公开路由（routes/index.ts），无需登录即可拉取活动配置

router.get('/', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  const highlights = promoHighlights(user, await hasFirstDeposit(ctx.state.env, user))
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
  try {
    const result = await withUserPromoLock(ctx, ctx.state.userId!, 'trial', async () => {
      const user = await getUser(ctx.state.redis, ctx.state.userId!)
      if (!user) throw new Error('User not found')
      if (user.trialClaimed) throw new Error('Trial bonus already claimed')
      const cfg = await getPromoConfig(ctx.state.env)
      if (!cfg.trial.enabled) throw new Error('Trial bonus is currently disabled')
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
      return { amountPhp: amount, amountCents: amount }
    })
    ok(ctx, result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Trial bonus claim failed'
    if (msg === 'User not found') {
      fail(ctx, 404, msg, 404)
      return
    }
    if (msg === 'errors.duplicateRequest') {
      fail(ctx, 429, msg, 429)
      return
    }
    fail(ctx, 409, msg)
  }
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
  const cfg = await getPromoConfig(ctx.state.env)
  const phpTiers = cfg.firstdep.tiers.PHP ?? []
  const maxPhpBonus = phpTiers.length ? Math.max(...phpTiers.map((tier) => tier.bonusAmount)) : 0
  ok(ctx, {
    ...promo,
    rules: promo.description,
    turnoverMultiplier: promo.promoId === 'firstdep' ? cfg.firstdep.turnoverX : 1,
    maxBonusPhp: promo.promoId === 'firstdep' ? maxPhpBonus : 88,
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
    try {
      const result = await withUserPromoLock(ctx, user.id, 'referral', async () => {
        const lockedUser = await getUser(ctx.state.redis, user.id)
        if (!lockedUser || !lockedUser.referralReady || lockedUser.referralClaimed) {
          throw new Error('Referral reward not available')
        }
        const cfg = await getPromoConfig(ctx.state.env)
        if (!cfg.referral.enabled) throw new Error('Referral bonus is currently disabled')
        const amount = cfg.referral.inviterAmount
        lockedUser.referralClaimed = true
        lockedUser.referralReady = false
        await saveUser(ctx.state.redis, lockedUser)
        await creditWallet(ctx.state.redis, lockedUser.id, amount, {
          type: 'bonus',
          description: 'Referral bonus',
          createdAt: nowIso(),
          traceId: ctx.state.traceId,
        })
        if (cfg.referral.turnoverX > 0 && isMysqlEnabled(ctx.state.env)) {
          const expiresAt = cfg.referral.turnoverDays > 0
            ? new Date(Date.now() + cfg.referral.turnoverDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
            : null
          await createPromoRequirement(getMysqlPool(ctx.state.env), lockedUser.id, 'referral', amount, cfg.referral.turnoverX, expiresAt)
        }
        return { amountPhp: amount, amountCents: amount }
      })
      ok(ctx, result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Referral claim failed'
      if (msg === 'errors.duplicateRequest') {
        fail(ctx, 429, msg, 429)
        return
      }
      fail(ctx, 409, msg)
    }
    return
  }
  if (promoId === 'firstdep') {
    // 首充嘉年华改为充值成功后按档位自动入账，无需手动领取
    fail(ctx, 409, 'First deposit bonus is credited automatically on deposit')
    return
  }
  fail(ctx, 404, 'Promotion not found', 404)
})

export default router
