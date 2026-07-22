import { describe, it, expect, vi, beforeEach } from 'vitest'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import request from 'supertest'
import type { UserRecord, KycSubmission, WithdrawOrder } from '../types/domain.js'

vi.mock('../services/auth.service.js', async () => {
  class AuthError extends Error {
    status?: number
    constructor(message: string, status?: number) {
      super(message)
      this.status = status
    }
  }
  return {
    AuthError,
    loginWithInitData: vi.fn(),
    loginWithGoogleCode: vi.fn(),
    loginWithTelegramOidc: vi.fn(),
    loginWithTelegramWidget: vi.fn(),
    registerWithPassword: vi.fn(),
    loginWithPassword: vi.fn(),
    sendForgotPasswordOtp: vi.fn(),
    resetForgotPassword: vi.fn(),
    resolveSession: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
    toAuthUser: vi.fn(),
  }
})

vi.mock('../services/store/index.js', () => ({
  recordUserLogin: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/geo.service.js', () => ({
  lookupRegion: vi.fn(() => 'Metro Manila'),
}))

vi.mock('../services/agent.service.js', () => ({
  attributeAgentByDomain: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/otp-policy.service.js', () => ({
  getLoginPasswordFailureLimit: vi.fn(() => Promise.resolve(2)),
  getLoginPasswordLockSeconds: vi.fn(() => Promise.resolve(60)),
}))

vi.mock('../services/store.js', () => ({
  getWallet: vi.fn(),
  getWalletBalances: vi.fn(),
  creditWallet: vi.fn(),
  getKyc: vi.fn(),
  saveWithdraw: vi.fn(),
  listWithdrawals: vi.fn(),
  getWithdraw: vi.fn(),
  listUserIdentities: vi.fn(),
}))

vi.mock('../clients/mysql.client.js', () => ({
  isMysqlEnabled: vi.fn(() => false),
  getMysqlPool: vi.fn(),
}))

vi.mock('../services/turnover.service.js', () => ({
  canWithdraw: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../services/kyc.service.js', async () => {
  class KycError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  }
  return {
    KycError,
    isKycApproved: vi.fn(),
    getKycStepConfig: vi.fn(() => Promise.resolve({ requireDocument: true, requireFace: true })),
    buildKycStatusResponse: vi.fn((kyc: KycSubmission | null) => ({
      status: kyc?.status ?? 'none',
      reason: kyc?.rejectReason ?? null,
    })),
    sendKycOtp: vi.fn(),
    verifyKycOtp: vi.fn(),
    submitKycDocument: vi.fn(),
    submitKycFace: vi.fn(),
    submitKyc: vi.fn(),
  }
})

vi.mock('../services/withdraw-review.service.js', () => ({
  reviewWithdraw: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/matrix.service.js', () => ({
  generateMerchantOrderNo: vi.fn(() => 'MX-10001'),
  initMatrixWithdrawOrder: vi.fn(),
}))

vi.mock('../clients/matrix.client.js', () => ({
  isMatrixEnabled: vi.fn(() => false),
}))

vi.mock('../services/payment-channel.service.js', () => ({
  isCryptoChannelEnabled: vi.fn(() => Promise.resolve(true)),
}))

import authRouter from '../routes/auth.routes.js'
import walletRouter from '../routes/wallet.routes.js'
import withdrawRouter from '../routes/withdraw.routes.js'
import kycRouter from '../routes/kyc.routes.js'
import * as authSvc from '../services/auth.service.js'
import * as store from '../services/store.js'
import * as kycSvc from '../services/kyc.service.js'

const mockLoginWithInitData = vi.mocked(authSvc.loginWithInitData)
const mockLoginWithPassword = vi.mocked(authSvc.loginWithPassword)
const mockResolveSession = vi.mocked(authSvc.resolveSession)
const mockRefreshSession = vi.mocked(authSvc.refreshSession)
const mockLogout = vi.mocked(authSvc.logout)
const mockToAuthUser = vi.mocked(authSvc.toAuthUser)
const mockGetWallet = vi.mocked(store.getWallet)
const mockGetWalletBalances = vi.mocked(store.getWalletBalances)
const mockGetKyc = vi.mocked(store.getKyc)
const mockCreditWallet = vi.mocked(store.creditWallet)
const mockSaveWithdraw = vi.mocked(store.saveWithdraw)
const mockListWithdrawals = vi.mocked(store.listWithdrawals)
const mockGetWithdraw = vi.mocked(store.getWithdraw)
const mockListUserIdentities = vi.mocked(store.listUserIdentities)
const mockIsKycApproved = vi.mocked(kycSvc.isKycApproved)
const mockSendKycOtp = vi.mocked(kycSvc.sendKycOtp)
const mockSubmitKyc = vi.mocked(kycSvc.submitKyc)

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'BG-10001',
    displayName: 'Test User',
    inviteCode: 'ABC123',
    locale: 'en',
    status: 'active',
    registeredAt: '2026-01-01T00:00:00.000Z',
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
    ...overrides,
  }
}

function redisMock(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve('OK')),
    del: vi.fn(() => Promise.resolve(1)),
    incr: vi.fn(() => Promise.resolve(1)),
    expire: vi.fn(() => Promise.resolve(1)),
    ...overrides,
  }
}

function createApp(router: typeof authRouter, opts: { userId?: string; redis?: unknown } = {}) {
  const app = new Koa()
  app.use(bodyParser())
  app.use(async (ctx: Koa.Context, next: Koa.Next) => {
    ctx.state.redis = (opts.redis ?? redisMock()) as never
    ctx.state.env = {} as never
    ctx.state.traceId = 'test-trace'
    if (opts.userId) ctx.state.userId = opts.userId
    await next()
  })
  app.use(router.routes())
  app.use(router.allowedMethods())
  return app.callback()
}

describe('认证接口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const user = makeUser()
    mockToAuthUser.mockResolvedValue({ id: user.id, displayName: user.displayName } as never)
    mockLoginWithInitData.mockResolvedValue({
      token: 'token-1',
      expiresIn: 3600,
      isNewUser: true,
      trialRedPacketEligible: true,
      user,
    } as never)
  })

  it('POST /auth/telegram 使用 initData 登录并返回 token 与用户', async () => {
    const res = await request(createApp(authRouter))
      .post('/auth/telegram')
      .set('X-Telegram-Init-Data', 'query_id=abc')
      .send({ start_param: 'inv_ABC123' })

    expect(res.status).toBe(200)
    expect(res.body.data.token).toBe('token-1')
    expect(res.body.data.isNewUser).toBe(true)
    expect(mockLoginWithInitData).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'query_id=abc',
      'inv_ABC123',
      expect.any(String),
    )
  })

  it('GET /auth/session 无 Bearer token 返回 valid:false', async () => {
    const res = await request(createApp(authRouter)).get('/auth/session')

    expect(res.status).toBe(200)
    expect(res.body.data.valid).toBe(false)
    expect(mockResolveSession).not.toHaveBeenCalled()
  })

  it('POST /auth/refresh session 过期返回 401', async () => {
    mockRefreshSession.mockResolvedValue(null)

    const res = await request(createApp(authRouter))
      .post('/auth/refresh')
      .set('Authorization', 'Bearer expired')

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Session expired')
  })

  it('POST /auth/logout 有 token 时删除 session', async () => {
    const res = await request(createApp(authRouter))
      .post('/auth/logout')
      .set('Authorization', 'Bearer token-1')

    expect(res.status).toBe(200)
    expect(mockLogout).toHaveBeenCalledWith(expect.anything(), 'token-1')
  })

  it('POST /auth/login 连续失败达到阈值后锁定', async () => {
    const redis = redisMock({ incr: vi.fn(() => Promise.resolve(2)) })
    mockLoginWithPassword.mockRejectedValue(new authSvc.AuthError('Invalid credentials', 401))

    const res = await request(createApp(authRouter, { redis }))
      .post('/auth/login')
      .send({ method: 'phone', identifier: '09171234567', password: 'bad-pass' })

    expect(res.status).toBe(429)
    expect(res.body.message).toBe('errors.tooManyAttempts')
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('auth:login:lock'), '1', 'EX', 60)
  })
})

describe('钱包与提现接口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWallet.mockResolvedValue({ available: 1200, frozen: 50 })
    mockGetWalletBalances.mockResolvedValue([])
    mockGetKyc.mockResolvedValue({ status: 'approved' } as KycSubmission)
    mockIsKycApproved.mockResolvedValue(true)
    mockCreditWallet.mockResolvedValue({ available: 700, frozen: 0 })
    mockSaveWithdraw.mockResolvedValue(undefined)
  })

  it('GET /wallet/balances 无多币种记录时返回 PHP 默认余额', async () => {
    const res = await request(createApp(walletRouter, { userId: 'BG-10001' })).get('/wallet/balances')

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([{ currency: 'PHP', available: 0, frozen: 0 }])
  })

  it('GET /wallet/summary 有冻结金额时返回 frozenNote', async () => {
    const res = await request(createApp(walletRouter, { userId: 'BG-10001' })).get('/wallet/summary')

    expect(res.status).toBe(200)
    expect(res.body.data.displayPhp).toBe('₱ 1,200.00')
    expect(res.body.data.frozenNote).toBeTruthy()
  })

  it('GET /withdrawals/eligibility KYC 通过且余额足够时 eligible=true', async () => {
    const res = await request(createApp(withdrawRouter, { userId: 'BG-10001' }))
      .get('/withdrawals/eligibility?currency=PHP&channelId=tg_wallet&amount=500')

    expect(res.status).toBe(200)
    expect(res.body.data.eligible).toBe(true)
    expect(res.body.data.rejectReasons).toEqual([])
  })

  it('GET /withdrawals/eligibility 非 tg_wallet 通道返回 400', async () => {
    const res = await request(createApp(withdrawRouter, { userId: 'BG-10001' }))
      .get('/withdrawals/eligibility?currency=PHP&channelId=yfpay&amount=500')

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('v0.1 only supports channelId=tg_wallet')
  })

  it('POST /withdrawals 未实名时禁止提款且不扣款', async () => {
    mockIsKycApproved.mockResolvedValue(false)

    const res = await request(createApp(withdrawRouter, { userId: 'BG-10001' }))
      .post('/withdrawals')
      .send({ amount: 500, currency: 'PHP', channelId: 'tg_wallet' })

    expect(res.status).toBe(403)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })

  it('POST /withdrawals 锁存在时拒绝重复提现', async () => {
    const redis = redisMock({ set: vi.fn(() => Promise.resolve(null)) })

    const res = await request(createApp(withdrawRouter, { userId: 'BG-10001', redis }))
      .post('/withdrawals')
      .send({ amount: 500, currency: 'PHP', channelId: 'tg_wallet' })

    expect(res.status).toBe(429)
    expect(res.body.code).toBe(429)
    expect(mockCreditWallet).not.toHaveBeenCalled()
  })

  it('POST /withdrawals 成功创建订单时扣款、保存订单并释放锁', async () => {
    let lockVal = ''
    const redis = redisMock({
      set: vi.fn((_key: string, value: string) => {
        lockVal = value
        return Promise.resolve('OK')
      }),
      get: vi.fn(() => Promise.resolve(lockVal)),
    })

    const res = await request(createApp(withdrawRouter, { userId: 'BG-10001', redis }))
      .post('/withdrawals')
      .send({ amount: 500, currency: 'PHP', channelId: 'tg_wallet' })

    expect(res.status).toBe(200)
    expect(res.body.data.orderId).toMatch(/^WDR/)
    expect(mockCreditWallet).toHaveBeenCalledWith(
      redis,
      'BG-10001',
      -500,
      expect.objectContaining({ type: 'withdraw' }),
    )
    expect(mockSaveWithdraw).toHaveBeenCalledOnce()
    expect(redis.del).toHaveBeenCalledWith('withdraw:lock:BG-10001')
  })

  it('GET /withdrawals/:orderId 不能查看其他用户订单', async () => {
    mockGetWithdraw.mockResolvedValue({
      orderId: 'WDR-1',
      userId: 'BG-OTHER',
      amount: 100,
      currency: 'PHP',
      channelId: 'tg_wallet',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as WithdrawOrder)

    const res = await request(createApp(withdrawRouter, { userId: 'BG-10001' })).get('/withdrawals/WDR-1')

    expect(res.status).toBe(404)
  })

  it('GET /withdrawals 返回当前用户提现历史', async () => {
    mockListWithdrawals.mockResolvedValue([
      {
        orderId: 'WDR-1',
        userId: 'BG-10001',
        amount: 100,
        currency: 'PHP',
        channelId: 'tg_wallet',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ] as WithdrawOrder[])

    const res = await request(createApp(withdrawRouter, { userId: 'BG-10001' })).get('/withdrawals?page=2')

    expect(res.status).toBe(200)
    expect(res.body.data.page).toBe(2)
    expect(res.body.data.items[0].orderId).toBe('WDR-1')
  })
})

describe('KYC 接口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKyc.mockResolvedValue(null)
    mockListUserIdentities.mockResolvedValue([])
    mockSendKycOtp.mockResolvedValue({ sent: true } as never)
    mockSubmitKyc.mockResolvedValue({ status: 'pending' } as never)
  })

  it('GET /kyc/status 无提交记录时返回 none 与步骤配置', async () => {
    const res = await request(createApp(kycRouter, { userId: 'BG-10001' })).get('/kyc/status')

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('none')
    expect(res.body.data.requireDocument).toBe(true)
    expect(res.body.data.requireFace).toBe(true)
  })

  it('POST /kyc/phone/send-otp 缺少 phone 返回 400', async () => {
    const res = await request(createApp(kycRouter, { userId: 'BG-10001' }))
      .post('/kyc/phone/send-otp')
      .send({})

    expect(res.status).toBe(400)
    expect(mockSendKycOtp).not.toHaveBeenCalled()
  })

  it('POST /kyc/submissions 缺少证件图片返回 400', async () => {
    const res = await request(createApp(kycRouter, { userId: 'BG-10001' }))
      .post('/kyc/submissions')
      .send({ fullName: 'Juan Dela Cruz' })

    expect(res.status).toBe(400)
    expect(mockSubmitKyc).not.toHaveBeenCalled()
  })

  it('GET /kyc/submissions/latest 有记录时返回最近提交详情', async () => {
    mockGetKyc.mockResolvedValue({
      userId: 'BG-10001',
      status: 'pending',
      verifyMode: 'face',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } as KycSubmission)

    const res = await request(createApp(kycRouter, { userId: 'BG-10001' })).get('/kyc/submissions/latest')

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('pending')
    expect(res.body.data.verifyMode).toBe('face')
  })
})
