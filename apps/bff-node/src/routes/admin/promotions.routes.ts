import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getPromoConfig, savePromoConfig, type PromoConfig } from '../../services/promo-config.service.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
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
    firstdep: { ...current.firstdep, ...(body.firstdep ?? {}) },
    appdl:    { ...current.appdl,    ...(body.appdl    ?? {}) },
    redep:    { ...current.redep,    ...(body.redep    ?? {}) },
    popups:   body.popups ?? current.popups,
    bonusCards: body.bonusCards ?? current.bonusCards,
  }

  // 简单校验
  if (updated.trial.amount <= 0 || updated.trial.amount > 50000) {
    fail(ctx, 400, 'trial.amount 必须在 1-50000 之间'); return
  }
  if (updated.firstdep.turnoverX < 0 || updated.firstdep.turnoverDays < 0) {
    fail(ctx, 400, 'firstdep 流水倍率/有效期不能为负'); return
  }
  if (updated.appdl.amount <= 0 || updated.appdl.amount > 50000 || updated.appdl.turnoverX < 0 || updated.appdl.turnoverDays < 0) {
    fail(ctx, 400, 'appdl 金额必须在 1-50000、流水倍率/有效期不能为负'); return
  }
  if (updated.redep.minDeposit <= 0 || updated.redep.bonusAmount < 0 || updated.redep.windowHours <= 0
    || updated.redep.cooldownDays < 0 || updated.redep.turnoverX < 0 || updated.redep.turnoverDays < 0) {
    fail(ctx, 400, 'redep 档位/时长必须为正,奖励/冷却/流水参数不能为负'); return
  }
  for (const [currency, list] of Object.entries(updated.firstdep.tiers)) {
    for (const tier of list) {
      if (!(tier.depositAmount > 0) || tier.bonusAmount < 0) {
        fail(ctx, 400, `firstdep ${currency} 档位金额必须大于 0、奖励不能为负`); return
      }
    }
  }
  await savePromoConfig(ctx.state.env, updated)
  ok(ctx, updated)
})

function promoLabel(type: string, description: string): string {
  if (type === 'red_packet') {
    if (/app download/i.test(description)) return 'App下载礼金'
    return '首席体验官'
  }
  if (type === 'bonus') {
    if (/referral/i.test(description)) return '邀请共赢'
    if (/first deposit/i.test(description)) return '首充嘉年华'
    return '活动奖励'
  }
  return type
}

router.get('/claims', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [], total: 0, page: 1, pageSize: 20 }); return }
  const pool = getMysqlPool(ctx.state.env)
  const page     = Math.max(1, Number(ctx.query.page     ?? 1))
  const pageSize = Math.min(1000, Math.max(1, Number(ctx.query.pageSize ?? 20)))
  const promoId  = ctx.query.promoId ? String(ctx.query.promoId) : undefined
  const offset   = (page - 1) * pageSize

  const promoFilter = promoId === 'trial'    ? `AND l.type = 'red_packet' AND l.description NOT LIKE '%App download%'`
                    : promoId === 'referral'  ? `AND l.type = 'bonus' AND l.description LIKE '%Referral%'`
                    : promoId === 'firstdep'  ? `AND l.type = 'bonus' AND l.description LIKE '%First deposit%'`
                    : promoId === 'appdl'     ? `AND l.type = 'red_packet' AND l.description LIKE '%App download%'`
                    : ''

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, l.user_id, u.display_name, l.type, l.description,
            l.amount, l.currency, l.created_at AS claimed_at
     FROM bg_wallet_ledger l
     LEFT JOIN bg_user u ON u.id = l.user_id
     WHERE l.type IN ('red_packet', 'bonus') ${promoFilter}
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset],
  )

  const [[countRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_wallet_ledger l
     WHERE l.type IN ('red_packet', 'bonus') ${promoFilter}`,
  )

  ok(ctx, {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      displayName: r.display_name ?? r.user_id,
      promoName: promoLabel(String(r.type), String(r.description)),
      amount: Number(r.amount),
      currency: String(r.currency),
      claimedAt: r.claimed_at instanceof Date ? r.claimed_at.toISOString() : String(r.claimed_at),
    })),
    total: Number(countRow?.total ?? 0),
    page,
    pageSize,
  })
})

export default router
