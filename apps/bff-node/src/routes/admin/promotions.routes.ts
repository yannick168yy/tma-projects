import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import {
  getPromoConfig, mergePromoConfig, savePromoConfig, validatePromoConfig, type PromoConfig,
} from '../../services/promo-config.service.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { fail, ok } from '../../utils/response.js'
import { requireRole } from '../../middleware/require-role.js'
import { writeAuditLog } from '../../services/admin-store.js'
import { getTenantMarkets } from '../../services/brand.service.js'
import {
  applyTemplateForCurrentTenant, listTemplatesForTenant,
} from '../../services/promo-template.service.js'

const router = new Router({ prefix: '/promotions' })

router.get('/config', async (ctx) => {
  const config = await getPromoConfig(ctx.state.env)
  ok(ctx, config)
})

router.put('/config', async (ctx) => {
  const body = ctx.request.body as Partial<PromoConfig>
  const current = await getPromoConfig(ctx.state.env)
  const updated = mergePromoConfig(current, body)
  // 校验与「活动模板套用」共用一份（P3-3）：两份校验漂移的后果是
  // 「后台改不进去的值，套模板能进去」
  const err = validatePromoConfig(updated)
  if (err) { fail(ctx, 400, err); return }
  await savePromoConfig(ctx.state.env, updated)
  ok(ctx, updated)
})

export function promoLabel(type: string, description: string): string {
  if (type === 'red_packet') {
    if (/app download/i.test(description)) return 'App下载礼金'
    return '首席体验官'
  }
  if (type === 'bonus') {
    if (/regular redeposit/i.test(description)) return '常规复充赠金'
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

  if (promoId === 'regular_redep') {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id,c.order_id,c.user_id,u.display_name,c.deposit_amount,c.bonus_amount,c.currency,
              CASE WHEN c.status='pending' AND c.expires_at<=NOW(3) THEN 'expired' ELSE c.status END status,
              c.expires_at,c.claimed_at,c.created_at
       FROM bg_regular_redep_claim c
       LEFT JOIN bg_user u ON u.id=c.user_id
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [pageSize, offset],
    )
    const [[countRow]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) total FROM bg_regular_redep_claim')
    ok(ctx, {
      items: rows.map((r) => ({
        id: String(r.id), userId: String(r.user_id), displayName: r.display_name ?? r.user_id,
        promoName: '常规复充赠金', orderId: String(r.order_id), depositAmount: Number(r.deposit_amount),
        amount: Number(r.bonus_amount), currency: String(r.currency), status: String(r.status),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
        claimedAt: r.claimed_at instanceof Date ? r.claimed_at.toISOString() : r.claimed_at ? String(r.claimed_at) : null,
      })),
      total: Number(countRow?.total ?? 0), page, pageSize,
    })
    return
  }

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

// ── 活动模板自助套用（P3-3 / P3-5）─────────────────────────────────────────
// 🔴 只能套到自己身上：tenantId 取自上下文，不接受入参。
// 模板内容（别家调出来的参数）不下发给租户，只给名字与覆盖范围。
router.get('/templates', async (ctx) => {
  const tenant = ctx.state.tenant
  const markets = tenant ? (await getTenantMarkets(tenant.id).catch(() => [])).map((m) => m.market) : []
  ok(ctx, await listTemplatesForTenant(markets))
})

router.post('/templates/:id/apply', requireRole(['super_admin', 'ops']), async (ctx) => {
  try {
    const res = await applyTemplateForCurrentTenant(
      ctx.state.env, Number(ctx.params.id), ctx.state.adminUsername ?? null)
    await writeAuditLog(ctx.state.env, {
      adminId: ctx.state.adminId!,
      adminUsername: ctx.state.adminUsername!,
      action: 'promo.template.apply',
      targetType: 'promo_template',
      targetId: String(ctx.params.id),
      detail: res,
      ip: ctx.ip,
    })
    ok(ctx, { ...res, config: await getPromoConfig(ctx.state.env) })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '套用失败')
  }
})
