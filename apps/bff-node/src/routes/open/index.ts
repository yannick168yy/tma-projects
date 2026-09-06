import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { currentTenant } from '../../lib/tenant-context.js'
import { openApiAuth, requireScope } from '../../middleware/open-api-auth.js'
import { API_SCOPES, SCOPE_LABEL } from '../../services/open-api.service.js'
import { ok, fail } from '../../utils/response.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 分页统一口径：page 从 1 开始，pageSize 上限 200（再大就该走导出而不是 API 翻页） */
function paging(ctx: { query: Record<string, unknown> }): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(200, Math.max(1, Number(ctx.query.pageSize ?? 50)))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/** 时间窗：默认近 7 天，最长 92 天。不限窗口的查询迟早会有人拉全表 */
function window(ctx: { query: Record<string, unknown> }): { from: string; to: string } | string {
  const to = String(ctx.query.to ?? new Date().toISOString().slice(0, 10))
  const from = String(ctx.query.from ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10))
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return '日期格式需为 YYYY-MM-DD'
  const days = (Date.parse(to) - Date.parse(from)) / 86400_000
  if (days < 0) return 'from 不能晚于 to'
  if (days > 92) return '单次查询窗口最长 92 天，请分段拉取'
  return { from, to }
}

/**
 * 开放 API v1（P3-7）。
 *
 * 只读。给客户拿自己的数据去做报表、对账、推数到他自己的系统 ——
 * 「后台再加一个字段/报表」的需求引到这里，而不是改后台代码。
 *
 * 🔴 每个 handler 都直接用 getMysqlPool()，靠 openApiAuth 里的 runWithTenant
 * 提供隔离。接口上没有任何 tenant 参数，客户拿到的永远是自己那份数据。
 */
export function createOpenApiRouter(): Router {
  // 挂在 /api/open/v1 而不是 /api/v1/open：v1 是开放 API 自己的版本号，
  // 与内部 API 的 v1 不是一回事，套在一起以后想给开放 API 单独升版都说不清
  const router = new Router({ prefix: '/api/open/v1' })
  router.use(openApiAuth())

  router.get('/me', async (ctx) => {
    const tenant = currentTenant()
    const key = ctx.state.apiKey!
    ok(ctx, {
      tenant: { code: tenant.code, status: tenant.status },
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      ratePerMin: key.ratePerMin,
      availableScopes: API_SCOPES.map((s) => ({ scope: s, label: SCOPE_LABEL[s] })),
    })
  })

  router.get('/users', requireScope('users:read'), async (ctx) => {
    const { page, pageSize, offset } = paging(ctx)
    const db = getMysqlPool(ctx.state.env)
    // 不下发手机号与邮箱：客户后台里能看，但 API 是会被存到他自己库里的，
    // 减少一层扩散面；要联系方式就用后台导出（有审计）
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, display_name, market, status, label, invite_code, inviter_id, registered_at, last_login_at
         FROM bg_user ORDER BY registered_at DESC LIMIT ? OFFSET ?`, [pageSize, offset])
    const [[cnt]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM bg_user') as unknown as [RowDataPacket[]]
    ok(ctx, { page, pageSize, total: Number(cnt.n), items: rows })
  })

  router.get('/deposits', requireScope('orders:read'), async (ctx) => {
    const w = window(ctx)
    if (typeof w === 'string') return fail(ctx, 400, w)
    const { page, pageSize, offset } = paging(ctx)
    const status = ctx.query.status ? String(ctx.query.status) : null
    const db = getMysqlPool(ctx.state.env)
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT order_id, user_id, channel, settlement_mode, currency, amount, status, credited, created_at, updated_at
         FROM bg_deposit_order
        WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
          ${status ? 'AND status = ?' : ''}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      status ? [w.from, w.to, status, pageSize, offset] : [w.from, w.to, pageSize, offset])
    ok(ctx, { page, pageSize, window: w, items: rows })
  })

  router.get('/withdrawals', requireScope('orders:read'), async (ctx) => {
    const w = window(ctx)
    if (typeof w === 'string') return fail(ctx, 400, w)
    const { page, pageSize, offset } = paging(ctx)
    const status = ctx.query.status ? String(ctx.query.status) : null
    const db = getMysqlPool(ctx.state.env)
    // 不下发 to_address / extra：收款账号属于玩家隐私，且是联防要保护的对象
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT order_id, user_id, channel, settlement_mode, currency, amount, status,
              review_verdict, handled_by, created_at, updated_at
         FROM bg_withdraw_order
        WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
          ${status ? 'AND status = ?' : ''}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      status ? [w.from, w.to, status, pageSize, offset] : [w.from, w.to, pageSize, offset])
    ok(ctx, { page, pageSize, window: w, items: rows })
  })

  router.get('/bets', requireScope('bets:read'), async (ctx) => {
    const w = window(ctx)
    if (typeof w === 'string') return fail(ctx, 400, w)
    const { page, pageSize, offset } = paging(ctx)
    const userId = ctx.query.userId ? String(ctx.query.userId) : null
    const db = getMysqlPool(ctx.state.env)
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, user_id, txn_type, gpid, provider_id, currency, amount, win_loss, voided_at, created_at
         FROM bg_568win_wallet_txn
        WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
          ${userId ? 'AND user_id = ?' : ''}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      userId ? [w.from, w.to, userId, pageSize, offset] : [w.from, w.to, pageSize, offset])
    ok(ctx, { page, pageSize, window: w, items: rows })
  })

  router.get('/stats/daily', requireScope('stats:read'), async (ctx) => {
    const w = window(ctx)
    if (typeof w === 'string') return fail(ctx, 400, w)
    const db = getMysqlPool(ctx.state.env)
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT stat_date, currency, deposit_amount, deposit_count, deposit_users, withdraw_amount,
              bet_amount, payout_amount, bet_users, bonus_cost, first_dep_users, first_dep_amount
         FROM bi_daily_platform WHERE stat_date BETWEEN ? AND ? ORDER BY stat_date DESC, currency`,
      [w.from, w.to])
    ok(ctx, { window: w, items: rows })
  })

  // 平台账单：客户拿去和自己的账对。数据在平台库，按当前租户过滤
  router.get('/billing/invoices', requireScope('billing:read'), async (ctx) => {
    const tenant = currentTenant()
    const [rows] = await getPlatformPool().query<RowDataPacket[]>(
      `SELECT invoice_no, period_start, period_end, currency, gross_amount, adjust_amount,
              total_amount, carry_in, carry_out, status, issued_at, confirmed_at, settled_at
         FROM pf_invoice WHERE tenant_id = ? ORDER BY period_start DESC LIMIT 100`, [tenant.id])
    ok(ctx, { items: rows })
  })

  router.get('/billing/daily', requireScope('billing:read'), async (ctx) => {
    const w = window(ctx)
    if (typeof w === 'string') return fail(ctx, 400, w)
    const tenant = currentTenant()
    const [rows] = await getPlatformPool().query<RowDataPacket[]>(
      `SELECT stat_date, currency, fx_rate_usdt, deposit_amount, deposit_platform, deposit_tenant,
              withdraw_amount, turnover, payout, ggr, bonus_cost, commission_cost, channel_fee,
              locked_at IS NOT NULL AS locked
         FROM pf_billing_daily WHERE tenant_id = ? AND stat_date BETWEEN ? AND ?
        ORDER BY stat_date DESC, currency`, [tenant.id, w.from, w.to])
    ok(ctx, { window: w, items: rows })
  })

  return router
}
