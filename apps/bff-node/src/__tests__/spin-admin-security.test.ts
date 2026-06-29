import { describe, it, expect, vi, beforeEach } from 'vitest'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import request from 'supertest'

vi.mock('../services/spin.service.js', () => ({
  getSpinStatus: vi.fn(),
  getPublicSpinStatus: vi.fn(),
  drawSpin: vi.fn(),
  listSpinRecords: vi.fn(),
}))

vi.mock('../services/admin-store.js', () => ({
  getOpPasswordHash: vi.fn(),
  setOpPassword: vi.fn(),
  getSmsTestMode: vi.fn(),
  setSmsTestMode: vi.fn(),
  getAdminSetting: vi.fn(),
  setAdminSetting: vi.fn(),
  writeAuditLog: vi.fn(),
}))

vi.mock('../services/admin-auth.service.js', () => ({
  hashPassword: vi.fn(() => Promise.resolve('hash:new')),
  verifyPassword: vi.fn(),
}))

vi.mock('../services/otp-policy.service.js', () => ({
  DEFAULT_SMS_DAILY_IP_LIMIT: 100,
  DEFAULT_SMS_DAILY_LIMIT: 20,
  DEFAULT_KYC_DOC_FAILURE_LIMIT: 3,
  DEFAULT_KYC_FACE_FAILURE_LIMIT: 3,
  DEFAULT_LOGIN_PASSWORD_FAILURE_LIMIT: 5,
  DEFAULT_LOGIN_PASSWORD_LOCK_SECONDS: 900,
  DEFAULT_OTP_LOCK_SECONDS: 60,
  KYC_DOC_FAILURE_LIMIT_KEY: 'kyc_doc_failure_limit',
  KYC_FACE_FAILURE_LIMIT_KEY: 'kyc_face_failure_limit',
  LOGIN_PASSWORD_FAILURE_LIMIT_KEY: 'login_password_failure_limit',
  LOGIN_PASSWORD_LOCK_SECONDS_KEY: 'login_password_lock_seconds',
  OTP_LOCK_SECONDS_KEY: 'otp_lock_seconds',
  SMS_DAILY_IP_LIMIT_KEY: 'sms_daily_ip_limit',
  SMS_DAILY_LIMIT_KEY: 'sms_daily_limit',
  getKycDocFailureLimit: vi.fn(() => Promise.resolve(3)),
  getKycFaceFailureLimit: vi.fn(() => Promise.resolve(3)),
  getLoginPasswordFailureLimit: vi.fn(() => Promise.resolve(5)),
  getLoginPasswordLockSeconds: vi.fn(() => Promise.resolve(900)),
  getOtpLockSeconds: vi.fn(() => Promise.resolve(60)),
  getSmsDailyIpLimit: vi.fn(() => Promise.resolve(100)),
  getSmsDailyLimit: vi.fn(() => Promise.resolve(20)),
}))

vi.mock('../services/sms/send-log.js', () => ({
  listSmsSendLogs: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../services/exchange-rate.service.js', () => ({
  getAllCurrentRates: vi.fn(() => Promise.resolve([])),
  getRateHistory: vi.fn(() => Promise.resolve([])),
  setManualRate: vi.fn(),
  clearManualRate: vi.fn(),
  refreshRates: vi.fn(),
}))

import spinRouter from '../routes/spin.routes.js'
import settingsRouter from '../routes/admin/settings.routes.js'
import * as spinSvc from '../services/spin.service.js'
import * as adminStore from '../services/admin-store.js'
import * as adminAuth from '../services/admin-auth.service.js'

const mockGetSpinStatus = vi.mocked(spinSvc.getSpinStatus)
const mockGetPublicSpinStatus = vi.mocked(spinSvc.getPublicSpinStatus)
const mockDrawSpin = vi.mocked(spinSvc.drawSpin)
const mockListSpinRecords = vi.mocked(spinSvc.listSpinRecords)
const mockGetOpPasswordHash = vi.mocked(adminStore.getOpPasswordHash)
const mockSetOpPassword = vi.mocked(adminStore.setOpPassword)
const mockGetSmsTestMode = vi.mocked(adminStore.getSmsTestMode)
const mockSetSmsTestMode = vi.mocked(adminStore.setSmsTestMode)
const mockWriteAuditLog = vi.mocked(adminStore.writeAuditLog)
const mockVerifyPassword = vi.mocked(adminAuth.verifyPassword)

function redisMock() {
  return {}
}

function createSpinApp(userId?: string) {
  const app = new Koa()
  app.use(bodyParser())
  app.use(async (ctx: Koa.Context, next: Koa.Next) => {
    ctx.state.redis = redisMock() as never
    ctx.state.env = {} as never
    ctx.state.traceId = 'test-trace'
    if (userId) ctx.state.userId = userId
    await next()
  })
  app.use(spinRouter.routes())
  app.use(spinRouter.allowedMethods())
  return app.callback()
}

function createAdminSettingsApp(role = 'super_admin') {
  const app = new Koa()
  app.use(bodyParser())
  app.use(async (ctx: Koa.Context, next: Koa.Next) => {
    ctx.state.redis = redisMock() as never
    ctx.state.env = {} as never
    ctx.state.traceId = 'test-trace'
    ctx.state.adminId = 1
    ctx.state.adminUsername = 'admin'
    ctx.state.adminRole = role
    await next()
  })
  app.use(settingsRouter.routes())
  app.use(settingsRouter.allowedMethods())
  return app.callback()
}

describe('转盘接口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPublicSpinStatus.mockResolvedValue({ remainingChances: 0, prizes: [] } as never)
    mockGetSpinStatus.mockResolvedValue({ remainingChances: 2, prizes: [] } as never)
    mockDrawSpin.mockResolvedValue({ recordId: 'SPIN-1', amountPhp: 18 } as never)
    mockListSpinRecords.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 } as never)
  })

  it('GET /spin/status 游客返回公开状态', async () => {
    const res = await request(createSpinApp()).get('/spin/status?ruleId=2')

    expect(res.status).toBe(200)
    expect(mockGetPublicSpinStatus).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2)
    expect(mockGetSpinStatus).not.toHaveBeenCalled()
  })

  it('GET /spin/status 登录用户返回个人状态', async () => {
    const res = await request(createSpinApp('BG-10001')).get('/spin/status')

    expect(res.status).toBe(200)
    expect(res.body.data.remainingChances).toBe(2)
    expect(mockGetSpinStatus).toHaveBeenCalledWith(expect.anything(), 'BG-10001', expect.anything(), undefined)
  })

  it('POST /spin/draw 未登录返回 401', async () => {
    const res = await request(createSpinApp()).post('/spin/draw').send({ ruleId: 1 })

    expect(res.status).toBe(401)
    expect(mockDrawSpin).not.toHaveBeenCalled()
  })

  it('POST /spin/draw 服务层失败时返回业务错误', async () => {
    mockDrawSpin.mockRejectedValue(new Error('no chances'))

    const res = await request(createSpinApp('BG-10001')).post('/spin/draw').send({ ruleId: 1 })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('no chances')
  })

  it('GET /spin/records 限制 pageSize 最大为 50', async () => {
    const res = await request(createSpinApp('BG-10001')).get('/spin/records?page=0&pageSize=999')

    expect(res.status).toBe(200)
    expect(mockListSpinRecords).toHaveBeenCalledWith(expect.anything(), {
      page: 1,
      pageSize: 50,
      userId: 'BG-10001',
    })
  })
})

describe('后台设置权限', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpPasswordHash.mockResolvedValue(null)
    mockSetOpPassword.mockResolvedValue(undefined)
    mockGetSmsTestMode.mockResolvedValue(false)
    mockSetSmsTestMode.mockResolvedValue(undefined)
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockVerifyPassword.mockResolvedValue(true)
  })

  it('GET /settings/op-password 所有管理员可查询配置状态', async () => {
    const res = await request(createAdminSettingsApp('support')).get('/settings/op-password')

    expect(res.status).toBe(200)
    expect(res.body.data.configured).toBe(false)
  })

  it('POST /settings/op-password 非 super_admin 不可设置操作密码', async () => {
    const res = await request(createAdminSettingsApp('finance'))
      .post('/settings/op-password')
      .send({ newPassword: 'secret123' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(403)
    expect(mockSetOpPassword).not.toHaveBeenCalled()
  })

  it('POST /settings/op-password 首次设置成功', async () => {
    const res = await request(createAdminSettingsApp())
      .post('/settings/op-password')
      .send({ newPassword: 'secret123' })

    expect(res.status).toBe(200)
    expect(mockSetOpPassword).toHaveBeenCalledWith(expect.anything(), 'hash:new')
  })

  it('POST /settings/op-password 修改已有密码必须验证旧密码', async () => {
    mockGetOpPasswordHash.mockResolvedValue('hash:old')
    mockVerifyPassword.mockResolvedValue(false)

    const res = await request(createAdminSettingsApp())
      .post('/settings/op-password')
      .send({ currentPassword: 'wrong', newPassword: 'secret123' })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('currentPassword is incorrect')
    expect(mockSetOpPassword).not.toHaveBeenCalled()
  })

  it('PUT /settings/sms 非 super_admin 不可修改短信测试模式', async () => {
    const res = await request(createAdminSettingsApp('ops'))
      .put('/settings/sms')
      .send({ testMode: true })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(403)
    expect(mockSetSmsTestMode).not.toHaveBeenCalled()
  })

  it('PUT /settings/sms super_admin 修改后写审计日志', async () => {
    const res = await request(createAdminSettingsApp())
      .put('/settings/sms')
      .send({ testMode: true })

    expect(res.status).toBe(200)
    expect(res.body.data.testMode).toBe(true)
    expect(mockSetSmsTestMode).toHaveBeenCalledWith(expect.anything(), expect.anything(), true)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'sms_test_mode_update' }),
    )
  })
})
