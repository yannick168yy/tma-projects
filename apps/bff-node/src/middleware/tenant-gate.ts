import type { Middleware } from 'koa'
import { canDeposit, canWithdraw, currentTenantOrNull, isSiteOpen } from '../lib/tenant-context.js'

/**
 * 欠费三级降级的生效点（P2-10）。
 *
 * 平台后台改 pf_tenant.status 后由这里真正拦住流量：
 *   withdraw_suspended → 停提现（第一级，玩家还能充值、还能玩）
 *   deposit_suspended  → 停充值（第二级）
 *   suspended / closed → 停站（第三级，前台整站 503）
 *
 * 豁免项各有明确理由：
 * - `/admin`：客户自己的后台要能进去看为什么停了、去结账，否则只能打电话
 * - `/platform`：平台侧接口本身不属于任何租户，impersonate 也走这里
 * - `/webhooks`：TG/Viber 机器人回调，与资金无关，停站期间也不该断
 *
 * 只挡「创建」不挡「查询」：已经产生的订单要能查到终态，否则玩家看到的是一笔永远
 * pending 的单子。支付商回调本身落在 core-node（`/api/v1/callback/:provider`），
 * 走不到这里，不存在挡掉回调造成掉单的风险。
 */
const DEPOSIT_PATHS = [
  '/api/v1/deposits',
  '/api/v1/payment/deposit/create',
  '/api/v1/deposit/yfpay/create',
]
const WITHDRAW_PATHS = [
  '/api/v1/withdrawals',
  '/api/v1/payment/withdraw/create',
  '/api/v1/withdraw/yfpay/create',
  '/api/v1/promotions/team/withdraw',
]

export function tenantGateMiddleware(): Middleware {
  return async (ctx, next) => {
    const tenant = currentTenantOrNull()
    if (!tenant) return next()

    const p = ctx.path
    const exempt = !p.startsWith('/api/v1')
      || p.startsWith('/api/v1/admin')
      || p.startsWith('/api/v1/platform')
      || p.startsWith('/api/v1/webhooks')
    if (exempt) return next()

    if (!isSiteOpen(tenant)) {
      ctx.status = 503
      ctx.body = { code: 503, message: 'errors.siteSuspended', data: null, traceId: ctx.state.traceId }
      return
    }

    if (ctx.method === 'POST') {
      if (DEPOSIT_PATHS.includes(p) && !canDeposit(tenant)) {
        ctx.status = 403
        ctx.body = { code: 403, message: 'errors.depositSuspended', data: null, traceId: ctx.state.traceId }
        return
      }
      if (WITHDRAW_PATHS.includes(p) && !canWithdraw(tenant)) {
        ctx.status = 403
        ctx.body = { code: 403, message: 'errors.withdrawSuspended', data: null, traceId: ctx.state.traceId }
        return
      }
    }
    await next()
  }
}
