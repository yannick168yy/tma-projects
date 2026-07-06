/**
 * 后台活动参数配置接口测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import request from 'supertest'

vi.mock('../services/promo-config.service.js', () => ({
  getPromoConfig: vi.fn(),
  savePromoConfig: vi.fn(),
}))

// admin-auth service mock（绕过 token 验证）
vi.mock('../services/admin-auth.service.js', () => ({
  getAdminSession: vi.fn(),
}))

import adminPromotionsRouter from '../routes/admin/promotions.routes.js'
import * as promoConfigSvc from '../services/promo-config.service.js'
import * as adminAuthSvc from '../services/admin-auth.service.js'

const mockGetPromoConfig = vi.mocked(promoConfigSvc.getPromoConfig)
const mockSavePromoConfig = vi.mocked(promoConfigSvc.savePromoConfig)
const mockGetAdminSession = vi.mocked(adminAuthSvc.getAdminSession)

const DEFAULT_CONFIG = {
  trial:    { amount: 88, enabled: true, turnoverX: 0, turnoverDays: 0 },
  referral: { inviterAmount: 50, inviteeAmount: 30, enabled: true, turnoverX: 0, turnoverDays: 0 },
  firstdep: { enabled: true, turnoverX: 15, turnoverDays: 30, tiers: { PHP: [{ depositAmount: 100, bonusAmount: 15 }] } },
  appdl: { amount: 66, enabled: true, turnoverX: 5, turnoverDays: 30 },
  chdep: { enabled: false, channel: 'maya', minDeposit: 1000, amount: 50, turnoverX: 5, turnoverDays: 30, inactiveDays: 30 },
  popups: [{ id: 'new_player', enabled: true, order: 1, audience: 'all' as const, frequency: 'daily' as const }],
}

function createAdminApp() {
  const app = new Koa()
  app.use(bodyParser())
  // 直接注入 admin session（绕过 token 验证）
  app.use(async (ctx: Koa.Context, next: Koa.Next) => {
    ctx.state.redis = {} as never
    ctx.state.env = {} as never
    ctx.state.traceId = 'test-trace'
    ctx.state.adminId = 1
    ctx.state.adminUsername = 'admin'
    ctx.state.adminRole = 'super_admin'
    await next()
  })
  app.use(adminPromotionsRouter.routes())
  app.use(adminPromotionsRouter.allowedMethods())
  return app.callback()
}

describe('后台活动配置 (Admin Promotions Config)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPromoConfig.mockResolvedValue(DEFAULT_CONFIG)
    mockSavePromoConfig.mockResolvedValue(undefined)
    mockGetAdminSession.mockResolvedValue({
      adminId: 1,
      username: 'admin',
      role: 'super_admin',
    } as never)
  })

  it('GET /promotions/config — 返回当前配置', async () => {
    const res = await request(createAdminApp()).get('/promotions/config')

    expect(res.status).toBe(200)
    expect(res.body.data.trial.amount).toBe(88)
    expect(res.body.data.referral.inviterAmount).toBe(50)
    expect(res.body.data.firstdep.turnoverX).toBe(15)
    expect(res.body.data.firstdep.tiers.PHP[0].bonusAmount).toBe(15)
  })

  it('PUT /promotions/config — 修改 trial 金额为 120', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({ trial: { amount: 120 } })

    expect(res.status).toBe(200)
    expect(res.body.data.trial.amount).toBe(120)
    // 其他字段保持不变
    expect(res.body.data.referral.inviterAmount).toBe(50)
    expect(mockSavePromoConfig).toHaveBeenCalledOnce()
  })

  it('PUT /promotions/config — 关闭首充活动', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({ firstdep: { enabled: false } })

    expect(res.status).toBe(200)
    expect(res.body.data.firstdep.enabled).toBe(false)
    expect(res.body.data.firstdep.turnoverX).toBe(15) // 其他字段不变
  })

  it('PUT /promotions/config — trial.amount 超出范围（>50000）返回 400', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({ trial: { amount: 99999 } })

    expect(res.status).toBe(400)
    expect(mockSavePromoConfig).not.toHaveBeenCalled()
  })

  it('PUT /promotions/config — trial.amount 为 0 返回 400', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({ trial: { amount: 0 } })

    expect(res.status).toBe(400)
    expect(mockSavePromoConfig).not.toHaveBeenCalled()
  })

  it('PUT /promotions/config — referral 金额为负数返回 400', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({ referral: { inviterAmount: -10 } })

    expect(res.status).toBe(400)
    expect(mockSavePromoConfig).not.toHaveBeenCalled()
  })

  it('PUT /promotions/config — firstdep 档位金额为 0 返回 400', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({ firstdep: { tiers: { PHP: [{ depositAmount: 0, bonusAmount: 5 }] } } })

    expect(res.status).toBe(400)
    expect(mockSavePromoConfig).not.toHaveBeenCalled()
  })

  it('PUT /promotions/config — 可同时修改多个活动参数', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({
        trial: { amount: 100, enabled: false },
        referral: { inviterAmount: 60, inviteeAmount: 40 },
        firstdep: { turnoverX: 20 },
      })

    expect(res.status).toBe(200)
    expect(res.body.data.trial.amount).toBe(100)
    expect(res.body.data.trial.enabled).toBe(false)
    expect(res.body.data.referral.inviterAmount).toBe(60)
    expect(res.body.data.firstdep.turnoverX).toBe(20)
    expect(mockSavePromoConfig).toHaveBeenCalledOnce()
  })
})
