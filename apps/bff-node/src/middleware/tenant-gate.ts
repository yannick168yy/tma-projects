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
 * 三处豁免，每一处都有明确理由：
 * - `/admin`：客户自己的后台要能进去看为什么停了、去结账，否则只能打电话
 * - `/platform`：平台侧接口本身不属于任何租户，impersonate 也走这里
 * - `/webhooks`、支付回调查询：钱已经动了，回调必须能落库。挡回调只会造成掉单，
 *   而掉单的账最后还是要平台来对
 */
const DEPOSIT_PATHS = ['/api/v1/deposit', '/api/v1/payment/deposit/create']
const WITHDRAW_PATHS = ['/api/v1/withdraw', '/api/v1/payment/withdraw/create', '/api/v1/team/withdraw']

export function tenantGateMiddleware(): Middleware {
  return async (ctx, next) => {
    const tenant = currentTenantOrNull()
    if (!tenant) return next()

    const p = ctx.path
    const exempt = !p.startsWith('/api/v1')
      || p.startsWith('/api/v1/admin')
      || p.startsWith('/api/v1/platform')
      || p.startsWith('/api/v1/webhooks')
      || p.startsWith('/api/v1/yfpay')
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
