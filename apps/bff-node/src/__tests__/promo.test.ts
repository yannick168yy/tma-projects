/**
 * 三个活动的集成测试：首席体验官、邀请共赢、首充嘉年华
 * store 和 promo-config 全部 mock，只测试路由层业务逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import request from 'supertest'
import type { UserIdentity, UserRecord } from '../types/domain.js'

// mock 必须在 import 被提升之前声明（vitest 会 hoist vi.mock 调用）
vi.mock('../services/store.js', () => ({
  getUser: vi.fn(),
  saveUser: vi.fn(),
  creditWallet: vi.fn(),
  listLedger: vi.fn(),
  getKyc: vi.fn(),
  listUserIdentities: vi.fn(),
}))

vi.mock('../services/promo-config.service.js', () => ({
  getPromoConfig: vi.fn(),
}))

import promotionRouter from '../routes/promotion.routes.js'
import * as store from '../services/store.js'
import * as promoConfigSvc from '../services/promo-config.service.js'

const mockGetUser = vi.mocked(store.getUser)
const mockSaveUser = vi.mocked(store.saveUser)
const mockCreditWallet = vi.mocked(store.creditWallet)
const mockListLedger = vi.mocked(store.listLedger)
const mockGetKyc = vi.mocked(store.getKyc)
const mockListUserIdentities = vi.mocked(store.listUserIdentities)
const mockGetPromoConfig = vi.mocked(promoConfigSvc.getPromoConfig)

// ──────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'BG-10001',
    displayName: 'Test User',
    inviteCode: 'ABC123',
    locale: 'zh-CN',
    status: 'active',
    registeredAt: '2025-01-01T00:00:00.000Z',
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
    ...overrides,
  }
}

function makePhoneIdentity(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    provider: 'phone',
    identifier: '+639560285761',
    userId: 'BG-10001',
    verifiedAt: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const DEFAULT_CONFIG = {
  trial: { amount: 88, enabled: true, turnoverX: 3, turnoverDays: 0 },
  firstdep: { enabled: true, turnoverX: 15, turnoverDays: 30, tiers: { PHP: [{ depositAmount: 100, bonusAmount: 15 }, { depositAmount: 1000, bonusAmount: 70 }] } },
  appdl: { amount: 66, enabled: true, turnoverX: 5, turnoverDays: 30 },
  redep: { enabled: false, minDeposit: 500, bonusAmount: 75, byCcy: { PHP: { minDeposit: 500, bonusAmount: 75 }, USDT: { minDeposit: 8.62, bonusAmount: 1.29 }, USDC: { minDeposit: 8.62, bonusAmount: 1.29 } }, windowHours: 4, cooldownDays: 2, turnoverX: 1, turnoverDays: 30 },
  lossRebate: { enabled: false, ratePct: 5, minDeposit: 50, minDepositByCcy: { PHP: 50, USDT: 0.86, USDC: 0.86 }, windowDays: 7, capToDeposit: true, eligibleCats: ['slots', 'fishing'], settleHour: 0 },
  popups: [{ id: 'new_player', enabled: true, order: 1, audience: 'all' as const, frequency: 'daily' as const }],
  bonusCards: [{ id: 'trial' as const, enabled: true, order: 1, audience: 'all' as const }],
}

function createApp() {
  const app = new Koa()
  app.use(bodyParser())
  app.use(async (ctx: Koa.Context, next: Koa.Next) => {
    ctx.state.userId = 'BG-10001'
    ctx.state.redis = {} as never
    ctx.state.env = {} as never
    ctx.state.traceId = 'test-trace'
    await next()
  })
  app.use(promotionRouter.routes())
  app.use(promotionRouter.allowedMethods())
  return app.callback()
}

// ══════════════════════════════════════════
// 1. 首席体验官 (trial)
// ══════════════════════════════════════════
describe('首席体验官 (trial)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPromoConfig.mockResolvedValue(DEFAULT_CONFIG)
    mockSaveUser.mockResolvedValue(undefined)
    mockCreditWallet.mockResolvedValue({ available: 88, frozen: 0 })
    mockGetKyc.mockResolvedValue({ phoneVerified: true } as never)
    mockListUserIdentities.mockResolvedValue([makePhoneIdentity()])
  })

  it('GET /promotions/trial-play — 未领取时返回 claimed:false', async () => {
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: false }))
    const res = await request(createApp()).get('/promotions/trial-play')

    expect(res.status).toBe(200)
    expect(res.body.data.claimed).toBe(false)
    expect(res.body.data.amountPhp).toBe(88)
    expect(res.body.data.turnoverRequired).toBe(264) // 88 * 3
  })

  it('GET /promotions/trial-play — 已领取时返回 claimed:true', async () => {
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: true }))
    const res = await request(createApp()).get('/promotions/trial-play')

    expect(res.status).toBe(200)
    expect(res.body.data.claimed).toBe(true)
  })

  it('GET /promotions/trial-play — 配置金额改为 120 时，amountPhp 同步为 120', async () => {
    mockGetPromoConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      trial: { amount: 120, enabled: true, turnoverX: 3, turnoverDays: 0 },
    })
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: false }))
    const res = await request(createApp()).get('/promotions/trial-play')

    expect(res.status).toBe(200)
    expect(res.body.data.amountPhp).toBe(120)
    expect(res.body.data.turnoverRequired).toBe(360) // 120 * 3
  })

  it('POST /promotions/trial-play/claim — 成功领取，金额来自配置', async () => {
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: false }))
    const res = await request(createApp()).post('/promotions/trial-play/claim')

    expect(res.status).toBe(200)
    expect(res.body.data.amountPhp).toBe(88)
    expect(mockSaveUser).toHaveBeenCalledOnce()
    // 验证 saveUser 时 trialClaimed 已被置为 true
    const savedUser = mockSaveUser.mock.calls[0][1] as UserRecord
    expect(savedUser.trialClaimed).toBe(true)
    // creditWallet 被调用，金额 = 88
    expect(mockCreditWallet).toHaveBeenCalledWith(
      expect.anything(), 'BG-10001', 88, expect.objectContaining({ type: 'red_packet' }),
    )
  })

  it('POST /promotions/trial-play/claim — 配置金额改为 100 时，领取 100', async () => {
    mockGetPromoConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      trial: { amount: 100, enabled: true, turnoverX: 0, turnoverDays: 0 },
    })
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: false }))
    mockCreditWallet.mockResolvedValue({ available: 100, frozen: 0 })

    const res = await request(createApp()).post('/promotions/trial-play/claim')

    expect(res.status).toBe(200)
    expect(res.body.data.amountPhp).toBe(100)
    expect(mockCreditWallet).toHaveBeenCalledWith(
      expect.anything(), 'BG-10001', 100, expect.anything(),
    )
  })

  it('POST /promotions/trial-play/claim — 未绑手机号/未验证也可领取（免绑定）', async () => {
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: false }))
    mockGetKyc.mockResolvedValue({ phoneVerified: false } as never)
    mockListUserIdentities.mockResolvedValue([])

    const res = await request(createApp()).post('/promotions/trial-play/claim')

    expect(res.status).toBe(200)
    expect(res.body.data.amountPhp).toBe(88)
    expect(mockCreditWallet).toHaveBeenCalledOnce()
  })

  it('POST /promotions/trial-play/claim — 重复领取返回 409', async () => {
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: true }))
    const res = await request(createApp()).post('/promotions/trial-play/claim')

    expect(res.status).toBe(409)
    expect(res.body.code).toBe(409)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })

  it('POST /promotions/trial-play/claim — 活动关闭时返回 409', async () => {
    mockGetPromoConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      trial: { amount: 88, enabled: false, turnoverX: 0, turnoverDays: 0 },
    })
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: false }))
    const res = await request(createApp()).post('/promotions/trial-play/claim')

    expect(res.status).toBe(409)
    expect(res.body.code).toBe(409)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════
// 2. 首充嘉年华 (firstdep)
// ══════════════════════════════════════════
describe('首充嘉年华 (firstdep)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPromoConfig.mockResolvedValue(DEFAULT_CONFIG)
    mockSaveUser.mockResolvedValue(undefined)
    mockCreditWallet.mockResolvedValue({ available: 1000, frozen: 0 })
  })

  it('POST /promotions/firstdep/claim — 改为充值自动入账，手动领取返回 409', async () => {
    mockGetUser.mockResolvedValue(makeUser({ firstDepClaimed: false }))
    const res = await request(createApp()).post('/promotions/firstdep/claim')

    expect(res.status).toBe(409)
    expect(res.body.code).toBe(409)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════
// 4. 活动列表 highlight 状态
// ══════════════════════════════════════════
describe('活动列表 GET /promotions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('新用户（未领取任何活动）— trial 和 firstdep 高亮', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      trialClaimed: false,
      referralReady: false,
      referralClaimed: false,
      firstDepReady: false,
      firstDepClaimed: false,
    }))
    const res = await request(createApp()).get('/promotions')

    expect(res.status).toBe(200)
    const items: Array<{ promoId: string; highlight: boolean; flagLabel: string | null }> = res.body.data
    const trial = items.find(i => i.promoId === 'trial')
    const firstdep = items.find(i => i.promoId === 'firstdep')

    expect(trial?.highlight).toBe(true)
    expect(trial?.flagLabel).toBe('₱88')
    expect(firstdep?.highlight).toBe(true)
    expect(firstdep?.flagLabel).toBe('Deposit')
  })

  it('firstdep 未首存时高亮', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      trialClaimed: true,
      firstDepReady: false,
      firstDepClaimed: false,
    }))
    const res = await request(createApp()).get('/promotions')

    const items: Array<{ promoId: string; highlight: boolean; flagLabel: string | null }> = res.body.data
    const firstdep = items.find(i => i.promoId === 'firstdep')
    expect(firstdep?.highlight).toBe(true)
    expect(firstdep?.flagLabel).toBe('Deposit')
  })

  it('全部已领取 — 无高亮', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      trialClaimed: true,
      referralReady: false,
      referralClaimed: true,
      firstDepReady: false,
      firstDepClaimed: true,
    }))
    const res = await request(createApp()).get('/promotions')

    const items: Array<{ promoId: string; highlight: boolean }> = res.body.data
    expect(items.every(i => !i.highlight)).toBe(true)
  })
})
