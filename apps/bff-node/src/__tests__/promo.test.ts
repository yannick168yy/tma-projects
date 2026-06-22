/**
 * 三个活动的集成测试：首席体验官、邀请共赢、首充嘉年华
 * store 和 promo-config 全部 mock，只测试路由层业务逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import request from 'supertest'
import type { UserRecord } from '../types/domain.js'

// mock 必须在 import 被提升之前声明（vitest 会 hoist vi.mock 调用）
vi.mock('../services/store.js', () => ({
  getUser: vi.fn(),
  saveUser: vi.fn(),
  creditWallet: vi.fn(),
  listLedger: vi.fn(),
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

const DEFAULT_CONFIG = {
  trial: { amount: 88, enabled: true, turnoverX: 0, turnoverDays: 0 },
  referral: { inviterAmount: 50, inviteeAmount: 30, enabled: true, turnoverX: 0, turnoverDays: 0 },
  firstdep: { enabled: true, turnoverX: 15, turnoverDays: 30, tiers: { PHP: [{ depositAmount: 100, bonusAmount: 15 }, { depositAmount: 1000, bonusAmount: 70 }] } },
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
      trial: { amount: 120, enabled: true, turnoverX: 0, turnoverDays: 0 },
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

  it('POST /promotions/trial-play/claim — 重复领取返回 409', async () => {
    mockGetUser.mockResolvedValue(makeUser({ trialClaimed: true }))
    const res = await request(createApp()).post('/promotions/trial-play/claim')

    expect(res.status).toBe(400)
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

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(409)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════
// 2. 邀请共赢 (referral)
// ══════════════════════════════════════════
describe('邀请共赢 (referral)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPromoConfig.mockResolvedValue(DEFAULT_CONFIG)
    mockSaveUser.mockResolvedValue(undefined)
    mockCreditWallet.mockResolvedValue({ available: 50, frozen: 0 })
  })

  it('GET /promotions/referral — 返回邀请码和奖励信息', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      inviteCode: 'MYCODE',
      referralClaimed: false,
    }))
    const res = await request(createApp()).get('/promotions/referral')

    expect(res.status).toBe(200)
    expect(res.body.data.inviteCode).toBe('MYCODE')
    expect(res.body.data.totalRewardPhp).toBe(0)
    expect(res.body.data.pendingRewardPhp).toBe(0)
  })

  it('GET /promotions/referral — referralReady 时 pendingRewardPhp 来自配置', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      referralReady: true,
      referralClaimed: false,
    }))
    const res = await request(createApp()).get('/promotions/referral')

    expect(res.status).toBe(200)
    expect(res.body.data.pendingRewardPhp).toBe(50) // DEFAULT_CONFIG.referral.inviterAmount
    expect(res.body.data.totalRewardPhp).toBe(0)
  })

  it('GET /promotions/referral — inviterAmount 改为 80，pendingRewardPhp 同步为 80', async () => {
    mockGetPromoConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      referral: { inviterAmount: 80, inviteeAmount: 30, enabled: true, turnoverX: 0, turnoverDays: 0 },
    })
    mockGetUser.mockResolvedValue(makeUser({ referralReady: true, referralClaimed: false }))
    const res = await request(createApp()).get('/promotions/referral')

    expect(res.status).toBe(200)
    expect(res.body.data.pendingRewardPhp).toBe(80)
  })

  it('GET /promotions/referral/link — 返回 deepLink 和分享文案', async () => {
    mockGetUser.mockResolvedValue(makeUser({ inviteCode: 'TESTCD' }))
    const res = await request(createApp()).get('/promotions/referral/link')

    expect(res.status).toBe(200)
    expect(res.body.data.deepLink).toContain('TESTCD')
    expect(res.body.data.shareText).toContain('TESTCD')
  })

  it('POST /promotions/referral/claim — 就绪时成功领取 inviterAmount', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      referralReady: true,
      referralClaimed: false,
    }))
    const res = await request(createApp()).post('/promotions/referral/claim')

    expect(res.status).toBe(200)
    expect(res.body.data.amountPhp).toBe(50)
    const savedUser = mockSaveUser.mock.calls[0][1] as UserRecord
    expect(savedUser.referralClaimed).toBe(true)
    expect(savedUser.referralReady).toBe(false)
    expect(mockCreditWallet).toHaveBeenCalledWith(
      expect.anything(), 'BG-10001', 50, expect.objectContaining({ type: 'bonus' }),
    )
  })

  it('POST /promotions/referral/claim — inviterAmount 改为 80 时领取 80', async () => {
    mockGetPromoConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      referral: { inviterAmount: 80, inviteeAmount: 30, enabled: true, turnoverX: 0, turnoverDays: 0 },
    })
    mockGetUser.mockResolvedValue(makeUser({ referralReady: true, referralClaimed: false }))
    mockCreditWallet.mockResolvedValue({ available: 80, frozen: 0 })

    const res = await request(createApp()).post('/promotions/referral/claim')

    expect(res.status).toBe(200)
    expect(res.body.data.amountPhp).toBe(80)
    expect(mockCreditWallet).toHaveBeenCalledWith(
      expect.anything(), 'BG-10001', 80, expect.anything(),
    )
  })

  it('POST /promotions/referral/claim — 未就绪时返回 409', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      referralReady: false,
      referralClaimed: false,
    }))
    const res = await request(createApp()).post('/promotions/referral/claim')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(409)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })

  it('POST /promotions/referral/claim — 已领取时返回 409', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      referralReady: true,
      referralClaimed: true,
    }))
    const res = await request(createApp()).post('/promotions/referral/claim')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(409)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })

  it('POST /promotions/referral/claim — 活动关闭时返回 409', async () => {
    mockGetPromoConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      referral: { inviterAmount: 50, inviteeAmount: 30, enabled: false, turnoverX: 0, turnoverDays: 0 },
    })
    mockGetUser.mockResolvedValue(makeUser({ referralReady: true, referralClaimed: false }))
    const res = await request(createApp()).post('/promotions/referral/claim')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(409)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════
// 3. 首充嘉年华 (firstdep)
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

    expect(res.status).toBe(400)
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

  it('新用户（未领取任何活动）— trial 高亮，其余不高亮', async () => {
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
    const referral = items.find(i => i.promoId === 'referral')
    const firstdep = items.find(i => i.promoId === 'firstdep')

    expect(trial?.highlight).toBe(true)
    expect(trial?.flagLabel).toBe('₱88')
    expect(referral?.highlight).toBe(false)
    expect(firstdep?.highlight).toBe(false)
  })

  it('referralReady=true 且未领取 — referral 高亮', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      trialClaimed: true,
      referralReady: true,
      referralClaimed: false,
    }))
    const res = await request(createApp()).get('/promotions')

    const items: Array<{ promoId: string; highlight: boolean; flagLabel: string | null }> = res.body.data
    const referral = items.find(i => i.promoId === 'referral')
    expect(referral?.highlight).toBe(true)
    expect(referral?.flagLabel).toBe('Claim')
  })

  it('firstdep 自动入账 — 始终不高亮', async () => {
    mockGetUser.mockResolvedValue(makeUser({
      trialClaimed: true,
      firstDepReady: true,
      firstDepClaimed: false,
    }))
    const res = await request(createApp()).get('/promotions')

    const items: Array<{ promoId: string; highlight: boolean; flagLabel: string | null }> = res.body.data
    const firstdep = items.find(i => i.promoId === 'firstdep')
    expect(firstdep?.highlight).toBe(false)
    expect(firstdep?.flagLabel).toBe(null)
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
