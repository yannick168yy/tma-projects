import { describe, expect, it } from 'vitest'
import Koa from 'koa'
import request from 'supertest'
import { demoGuardMiddleware } from '../middleware/demo-guard.js'
import { runWithTenant, type TenantContext } from '../lib/tenant-context.js'

function appFor(isDemo: boolean) {
  const tenant: TenantContext = {
    id: 9,
    code: isDemo ? 'demo' : 'tenant1',
    database: isDemo ? 'betogo_demo' : 'betogo_tenant1',
    status: 'active',
    selfOperated: false,
    isDemo,
  }
  const app = new Koa()
  app.use((ctx, next) => runWithTenant(tenant, next))
  app.use(demoGuardMiddleware())
  app.use((ctx) => { ctx.status = 200; ctx.body = { code: 0, data: { passed: true } } })
  return app.callback()
}

describe('演示后台待办保护', () => {
  it('阻止提款、实名和客服样本被改变，并返回可展示的提示', async () => {
    const app = appFor(true)
    const paths = [
      '/api/v1/admin/withdrawals/WD-DEMO/approve',
      '/api/v1/admin/withdrawals/WD-DEMO/reject',
      '/api/v1/admin/kyc/U-DEMO/approve',
      '/api/v1/admin/kyc/U-DEMO/reject',
      '/api/v1/admin/cs/conversations/1/translate',
      '/api/v1/admin/cs/conversations/1/takeover',
      '/api/v1/admin/cs/conversations/1/close',
    ]

    for (const path of paths) {
      const res = await request(app).post(path)
      expect(res.status, path).toBe(200)
      expect(res.body.code, path).toBe(409)
      expect(res.body.data.demoBlocked, path).toBe(true)
      expect(res.body.message, path).toContain('演示环境已拦截该操作')
    }
  })

  it('非演示租户不受影响', async () => {
    const res = await request(appFor(false)).post('/api/v1/admin/withdrawals/WD-REAL/approve')
    expect(res.body).toEqual({ code: 0, data: { passed: true } })
  })
})
