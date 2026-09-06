/**
 * 后台活动参数配置接口测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import request from 'supertest'

// 只 mock 碰库的两个；mergePromoConfig / validatePromoConfig 是纯函数，
// 用真实实现才测得到「校验规则」本身（P3-3 把它们从路由里抽了出来）
vi.mock('../services/promo-config.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/promo-config.service.js')>()
  return { ...actual, getPromoConfig: vi.fn(), savePromoConfig: vi.fn() }
})

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
  firstdep: { enabled: true, turnoverX: 15, turnoverDays: 30, tiers: { PHP: [{ depositAmount: 100, bonusAmount: 15 }] } },
  appdl: { amount: 66, enabled: true, turnoverX: 5, turnoverDays: 30 },
  redep: { enabled: false, minDeposit: 500, bonusAmount: 75, byCcy: { PHP: { minDeposit: 500, bonusAmount: 75 }, USDT: { minDeposit: 8.62, bonusAmount: 1.29 }, USDC: { minDeposit: 8.62, bonusAmount: 1.29 } }, windowHours: 4, cooldownDays: 2, turnoverX: 1, turnoverDays: 30 },
  regularRedep: { enabled: true, tiers: { PHP: [{ depositAmount: 500, bonusAmount: 25 }], IDR: [], USDT: [], USDC: [] }, turnoverX: 3, turnoverDays: 30, claimHours: 24, dailyMaxClaims: 3, dailyBonusCaps: { PHP: 1200, IDR: 0, USDT: 0, USDC: 0 }, stackWithLimited: false },
  lossRebate: { enabled: false, ratePct: 5, minDeposit: 50, minDepositByCcy: { PHP: 50, USDT: 0.86, USDC: 0.86 }, windowDays: 7, capToDeposit: true, eligibleCats: ['slots', 'fishing'], settleHour: 0 },
  popups: [{ id: 'new_player', enabled: true, order: 1, audience: 'all' as const, frequency: 'daily' as const }],
  bonusCards: [{ id: 'trial' as const, enabled: true, order: 1, audience: 'all' as const }],
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
    expect(res.body.data.firstdep.turnoverX).toBe(15)
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
        firstdep: { turnoverX: 20 },
      })

    expect(res.status).toBe(200)
    expect(res.body.data.trial.amount).toBe(100)
    expect(res.body.data.trial.enabled).toBe(false)
    expect(res.body.data.firstdep.turnoverX).toBe(20)
    expect(mockSavePromoConfig).toHaveBeenCalledOnce()
  })

  it('PUT /promotions/config — 可修改常规复充档位与流水', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({ regularRedep: { turnoverX: 5, tiers: { PHP: [{ depositAmount: 800, bonusAmount: 60 }] } } })

    expect(res.status).toBe(200)
    expect(res.body.data.regularRedep.turnoverX).toBe(5)
    expect(res.body.data.regularRedep.tiers.PHP[0]).toEqual({ depositAmount: 800, bonusAmount: 60 })
    expect(mockSavePromoConfig).toHaveBeenCalledOnce()
  })

  it('PUT /promotions/config — 常规复充领取时限无效时拒绝保存', async () => {
    const res = await request(createAdminApp())
      .put('/promotions/config')
      .send({ regularRedep: { claimHours: 0 } })

    expect(res.status).toBe(400)
    expect(mockSavePromoConfig).not.toHaveBeenCalled()
  })
})
