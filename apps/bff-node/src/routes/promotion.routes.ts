import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { creditWallet, getUser, listLedger, saveUser } from '../services/store.js'
import { formatDisplayTime, nowIso } from '../utils/format.js'
import { fail, ok } from '../utils/response.js'
import { getPromoConfig, promoAmountByCurrency } from '../services/promo-config.service.js'
import { getOrCreateRedepOffer } from '../services/redep.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { createPromoRequirement } from '../services/turnover.service.js'
import { riskAllowed } from '../utils/risk-guard.js'
import { getClientIp, getDeviceId } from '../utils/client-context.js'
import { appdlClaimedOnSameDevice, trialClaimedOnSameDevice } from '../services/promo-device-guard.service.js'
import { claimRegularRedep, listRegularRedepClaims } from '../services/regular-redep.service.js'

const PROMOS = [
  {
    promoId: 'trial',
    title: 'Trial Officer',
    subtitle: 'Get ₱88 free play',
    description: 'New users receive a trial red packet after Telegram login.',
    ctaLabel: 'Claim',
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

function promoHighlights(user: Awaited<ReturnType<typeof getUser>>, firstDepositDone: boolean, trialAmount: number) {
  if (!user) return []
  return PROMOS.map((p) => {
    if (p.promoId === 'trial') {
      return { promoId: p.promoId, highlight: !user.trialClaimed, flagLabel: !user.trialClaimed ? `₱${trialAmount}` : null }
    }
    return { promoId: p.promoId, highlight: !firstDepositDone, flagLabel: !firstDepositDone ? 'Deposit' : null }
  })
}

// GET /promotions/config 已移至公开路由（routes/index.ts），无需登录即可拉取活动配置

// 复充限时优惠：进站拉取（符合人群时惰性开窗，窗口内重复拉取返回同一倒计时）；按币种独立
router.get('/redep-offer', async (ctx) => {
  const currency = (ctx.query.currency as string) || 'PHP'
  ok(ctx, await getOrCreateRedepOffer(ctx.state.env, ctx.state.userId!, currency))
})

router.get('/regular-redep/claims', async (ctx) => {
  const currency = ctx.query.currency ? String(ctx.query.currency).toUpperCase() : undefined
  if (currency && !['PHP', 'IDR', 'USDT', 'USDC'].includes(currency)) { fail(ctx, 400, 'invalid currency'); return }
  ok(ctx, await listRegularRedepClaims(ctx.state.env, ctx.state.userId!, currency))
})

router.post('/regular-redep/claims/:id/claim', async (ctx) => {
  const id = Number(ctx.params.id)
  if (!Number.isInteger(id) || id <= 0) { fail(ctx, 400, 'invalid claim'); return }
  try {
    const result = await withUserPromoLock(ctx, ctx.state.userId!, `regular-redep:${id}`, () =>
      claimRegularRedep(ctx.state.env, ctx.state.userId!, id))
    ok(ctx, result)
  } catch (error) {
    fail(ctx, 400, error instanceof Error ? error.message : 'errors.promoNotEligible')
  }
})

router.get('/', async (ctx) => {
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  const cfg = await getPromoConfig(ctx.state.env)
  const currency = String(ctx.query.currency ?? 'PHP').toUpperCase()
  const highlights = promoHighlights(user, await hasFirstDeposit(ctx.state.env, user), promoAmountByCurrency(cfg.trial, currency))
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
  const currency = String(ctx.query.currency ?? 'PHP').toUpperCase()
  const amount = promoAmountByCurrency(cfg.trial, currency)
  ok(ctx, {
    claimed: user.trialClaimed,
    amountPhp: amount,
    currency,
    turnoverRequired: amount * cfg.trial.turnoverX,
    turnoverCompleted: 0,
    canWithdraw: false,
  })
})

router.post('/trial-play/claim', async (ctx) => {
  try {
    if (!(await riskAllowed(ctx, 'promo_claim'))) return
    const result = await withUserPromoLock(ctx, ctx.state.userId!, 'trial', async () => {
      const user = await getUser(ctx.state.redis, ctx.state.userId!)
      if (!user) throw new Error('User not found')
      if (user.trialClaimed) throw new Error('Trial bonus already claimed')
      // 2026-07-27 起免绑手机号：领取即到账。防薅羊毛 = 设备去重(下方) + riskAllowed 风控
      // + 提现闸门（未存款纯彩金不可提、trial 流水墙），绑定手机号后移到提现前(KYC)
      if (isMysqlEnabled(ctx.state.env)
        && await trialClaimedOnSameDevice(getMysqlPool(ctx.state.env), user.id, [getDeviceId(ctx), user.registerDeviceId], ctx.get('x-fp-visitor') || undefined, getClientIp(ctx))) {
        throw new Error('errors.deviceAlreadyClaimed')
      }
      const body = (ctx.request.body ?? {}) as { currency?: string }
      const currency = String(body.currency ?? 'PHP').toUpperCase()
      const cfg = await getPromoConfig(ctx.state.env)
      if (!cfg.trial.enabled) throw new Error('Trial bonus is currently disabled')
      const amount = promoAmountByCurrency(cfg.trial, currency)
      user.trialClaimed = true
      await saveUser(ctx.state.redis, user)
      await creditWallet(ctx.state.redis, user.id, amount, {
        type: 'red_packet',
        currency,
        description: 'Trial Officer red packet',
        createdAt: nowIso(),
        traceId: ctx.state.traceId,
      })
      if (cfg.trial.turnoverX > 0 && isMysqlEnabled(ctx.state.env)) {
        const expiresAt = cfg.trial.turnoverDays > 0
          ? new Date(Date.now() + cfg.trial.turnoverDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
          : null
        await createPromoRequirement(getMysqlPool(ctx.state.env), user.id, 'trial', amount, cfg.trial.turnoverX, expiresAt, currency)
      }
      return { amountPhp: amount, amountCents: amount, currency }
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
    if (msg === 'errors.deviceAlreadyClaimed') {
      fail(ctx, 403, msg, 403)
      return
    }
    fail(ctx, 409, msg)
  }
})

// App/PWA 下载礼金：状态查询
router.get('/app-download', async (ctx) => {
  const cfg = await getPromoConfig(ctx.state.env)
  const currency = String(ctx.query.currency ?? 'PHP').toUpperCase()
  let claimed = false
  if (isMysqlEnabled(ctx.state.env)) {
    const [rows] = await getMysqlPool(ctx.state.env).query<RowDataPacket[]>(
      'SELECT 1 FROM bg_app_download_claim WHERE user_id = ? LIMIT 1',
      [ctx.state.userId!],
    )
    claimed = rows.length > 0
  }
  ok(ctx, {
    enabled: cfg.appdl.enabled,
    amountPhp: promoAmountByCurrency(cfg.appdl, currency),
    currency,
    turnoverX: cfg.appdl.turnoverX,
    turnoverDays: cfg.appdl.turnoverDays,
    claimed,
  })
})

// App/PWA 下载礼金：领取（客户端仅在 standalone/APK 内展示入口；服务端一人一次+记录来源）
router.post('/app-download/claim', async (ctx) => {
  try {
    if (!(await riskAllowed(ctx, 'promo_claim'))) return
    const body = (ctx.request.body ?? {}) as { source?: string; currency?: string }
    const source = body.source === 'apk' ? 'apk' : 'pwa'
    const currency = String(body.currency ?? 'PHP').toUpperCase()
    const result = await withUserPromoLock(ctx, ctx.state.userId!, 'appdl', async () => {
      if (!isMysqlEnabled(ctx.state.env)) throw new Error('App download bonus unavailable')
      const cfg = await getPromoConfig(ctx.state.env)
      if (!cfg.appdl.enabled) throw new Error('App download bonus is currently disabled')
      const amount = promoAmountByCurrency(cfg.appdl, currency)
      const pool = getMysqlPool(ctx.state.env)
      const deviceId = getDeviceId(ctx)
      const claimer = await getUser(ctx.state.redis, ctx.state.userId!)
      if (await appdlClaimedOnSameDevice(pool, ctx.state.userId!, [deviceId, claimer?.registerDeviceId], ctx.get('x-fp-visitor') || undefined, getClientIp(ctx))) {
        throw new Error('errors.deviceAlreadyClaimed')
      }
      const ua = String(ctx.get('user-agent') ?? '').slice(0, 500)
      const [res] = await pool.execute(
        'INSERT IGNORE INTO bg_app_download_claim (user_id, source, user_agent, ip, amount, device_id) VALUES (?, ?, ?, ?, ?, ?)',
        [ctx.state.userId!, source, ua, ctx.ip ?? '', amount, deviceId?.slice(0, 64) ?? null],
      )
      if ((res as { affectedRows: number }).affectedRows === 0) throw new Error('App download bonus already claimed')
      await creditWallet(ctx.state.redis, ctx.state.userId!, amount, {
        type: 'red_packet',
        currency,
        description: 'App download bonus',
        createdAt: nowIso(),
        traceId: ctx.state.traceId,
      })
      if (cfg.appdl.turnoverX > 0) {
        const expiresAt = cfg.appdl.turnoverDays > 0
          ? new Date(Date.now() + cfg.appdl.turnoverDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
          : null
        await createPromoRequirement(pool, ctx.state.userId!, 'appdl', amount, cfg.appdl.turnoverX, expiresAt, currency)
      }
      return { amountPhp: amount, currency }
    })
    ok(ctx, result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'App download bonus claim failed'
    if (msg === 'errors.duplicateRequest') {
      fail(ctx, 429, msg, 429)
      return
    }
    if (msg === 'errors.deviceAlreadyClaimed') {
      fail(ctx, 403, msg, 403)
      return
    }
    fail(ctx, 409, msg)
  }
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
  if (promoId === 'firstdep') {
    // 首充嘉年华改为充值成功后按档位自动入账，无需手动领取
    fail(ctx, 409, 'First deposit bonus is credited automatically on deposit')
    return
  }
  fail(ctx, 404, 'Promotion not found', 404)
})

export default router
