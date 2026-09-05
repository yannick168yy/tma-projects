import { describe, expect, it } from 'vitest'
import Koa from 'koa'
import request from 'supertest'
import { tenantGateMiddleware } from '../middleware/tenant-gate.js'
import { runWithTenant, type TenantContext, type TenantStatus } from '../lib/tenant-context.js'

function appFor(status: TenantStatus) {
  const tenant: TenantContext = {
    id: 9, code: 'demo1', database: 'betogo_demo1', status, selfOperated: false,
  }
  const app = new Koa()
  app.use((ctx, next) => runWithTenant(tenant, next))
  app.use(tenantGateMiddleware())
  app.use((ctx) => { ctx.status = 200; ctx.body = { ok: true } })
  return app.callback()
}

/**
 * 路径写错了拦不住任何东西，而返回 403 的假象让人以为生效了 ——
 * 这些用例锁住的是「真实挂载路径」，不是中间件里那份清单自己。
 */
describe('欠费降级拦截（P2-10）', () => {
  it('停提现：拦提现与佣金提现，放行充值与浏览', async () => {
    const app = appFor('withdraw_suspended')
    for (const p of ['/api/v1/withdrawals', '/api/v1/payment/withdraw/create',
      '/api/v1/withdraw/yfpay/create', '/api/v1/promotions/team/withdraw']) {
      const res = await request(app).post(p)
      expect(res.status, p).toBe(403)
      expect(res.body.message).toBe('errors.withdrawSuspended')
    }
    expect((await request(app).post('/api/v1/deposits')).status).toBe(200)
    expect((await request(app).get('/api/v1/site/config')).status).toBe(200)
  })

  it('停充值：拦充值，放行提现', async () => {
    const app = appFor('deposit_suspended')
    for (const p of ['/api/v1/deposits', '/api/v1/payment/deposit/create', '/api/v1/deposit/yfpay/create']) {
      const res = await request(app).post(p)
      expect(res.status, p).toBe(403)
      expect(res.body.message).toBe('errors.depositSuspended')
    }
    expect((await request(app).post('/api/v1/withdrawals')).status).toBe(200)
  })

  it('查询类接口不拦：已产生的订单要能查到终态', async () => {
    const app = appFor('deposit_suspended')
    expect((await request(app).post('/api/v1/payment/deposit/query')).status).toBe(200)
    expect((await request(app).post('/api/v1/deposit/yfpay/query')).status).toBe(200)
  })

  it('停站：前台整站 503，后台与平台接口仍可用', async () => {
    const app = appFor('suspended')
    expect((await request(app).get('/api/v1/site/config')).status).toBe(503)
    expect((await request(app).get('/api/v1/admin/users')).status).toBe(200)
    expect((await request(app).get('/api/v1/platform/tenants')).status).toBe(200)
    expect((await request(app).post('/api/v1/webhooks/telegram')).status).toBe(200)
  })

  it('正常与试用状态全部放行', async () => {
    for (const s of ['active', 'trial'] as TenantStatus[]) {
      const app = appFor(s)
      expect((await request(app).post('/api/v1/withdrawals')).status).toBe(200)
      expect((await request(app).post('/api/v1/deposits')).status).toBe(200)
    }
  })
})
