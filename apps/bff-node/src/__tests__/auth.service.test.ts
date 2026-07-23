import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserRecord } from '../types/domain.js'

const store = vi.hoisted(() => ({
  bindIdentity: vi.fn(),
  createDevUser: vi.fn(),
  createUserFromGoogle: vi.fn(),
  createUserFromPassword: vi.fn(),
  createUserFromTelegram: vi.fn(),
  createUserFromTelegramOidc: vi.fn(),
  deleteSession: vi.fn(),
  findKycByVerifiedPhone: vi.fn(),
  getCanonicalUserByTelegramOidcUsername: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  getUserIdentity: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByGoogleSub: vi.fn(),
  getUserByTelegramOidcSub: vi.fn(),
  getUserByTelegramOidcUsername: vi.fn(),
  getUserByInviteCode: vi.fn(),
  getUserByPhoneAccount: vi.fn(),
  getUserByTelegramId: vi.fn(),
  listUserIdentities: vi.fn(),
  reassignIdentity: vi.fn(),
  saveSession: vi.fn(),
  saveUser: vi.fn(),
}))

const oidc = vi.hoisted(() => ({
  exchangeTelegramOidcCode: vi.fn(),
}))

vi.mock('../services/store/index.js', () => store)
vi.mock('../services/telegramOidc.service.js', () => oidc)
vi.mock('../services/geo.service.js', () => ({
  lookupRegion: vi.fn(() => 'Metro Manila'),
}))
vi.mock('../services/agent.service.js', () => ({
  attributeAgentByBot: vi.fn(),
  findEntryBotAgent: vi.fn(),
  isEnabledAgentDomain: vi.fn(() => Promise.resolve(false)),
}))
vi.mock('../services/sms/index.js', () => ({
  getSmsProvider: vi.fn(),
  isSmsTestModeEnabled: vi.fn(),
}))
vi.mock('../services/sms/send-log.js', () => ({
  appendSmsSendLog: vi.fn(),
}))
vi.mock('../services/otp-policy.service.js', () => ({
  enforceSmsDailyLimit: vi.fn(),
  getOtpLockSeconds: vi.fn(),
  getSmsDailyIpLimit: vi.fn(),
  getSmsDailyLimit: vi.fn(),
  recordSmsSent: vi.fn(),
}))
vi.mock('../services/google.service.js', () => ({
  exchangeGoogleCode: vi.fn(),
}))

import { loginWithTelegramOidc } from '../services/auth.service.js'

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'BG-10008',
    displayName: 'Yannick',
    inviteCode: 'ABC12345',
    locale: 'en',
    status: 'active',
    registeredAt: '2026-07-23T06:59:51.367Z',
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
    ...overrides,
  }
}

describe('Telegram OIDC 登录', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.getUserByInviteCode.mockResolvedValue(null)
    store.getUserByTelegramId.mockResolvedValue(null)
    store.getUserByTelegramOidcSub.mockResolvedValue(null)
    store.bindIdentity.mockResolvedValue({})
    store.reassignIdentity.mockResolvedValue({})
    store.saveSession.mockResolvedValue(undefined)
    store.saveUser.mockResolvedValue(undefined)
  })

  it('同一 Telegram username 在不同域名产生新 sub 时复用最早账号', async () => {
    const existing = user()
    store.getCanonicalUserByTelegramOidcUsername.mockResolvedValue(existing)
    oidc.exchangeTelegramOidcCode.mockResolvedValue({
      sub: '2556186465208250291',
      username: 'yannickyyyy',
      displayName: 'Yannick',
    })

    const result = await loginWithTelegramOidc(
      {} as never,
      {
        TELEGRAM_OIDC_CLIENT_SECRET: '',
        TELEGRAM_OIDC_CLIENTS: 'betogo666.com=123:secret',
        TELEGRAM_OIDC_BOT_TOKENS: '',
        TELEGRAM_OIDC_REDIRECT_URI: 'https://betogo666.com/auth/telegram/callback',
        SESSION_TTL_SECONDS: 3600,
      } as never,
      'code-1',
      'https://betogo666.com/auth/telegram/callback',
      '194.5.82.142',
    )

    expect(result.user.id).toBe('BG-10008')
    expect(result.isNewUser).toBe(false)
    expect(store.createUserFromTelegramOidc).not.toHaveBeenCalled()
    expect(store.reassignIdentity).toHaveBeenCalledWith(expect.anything(), {
      userId: 'BG-10008',
      provider: 'telegram_oidc',
      identifier: '2556186465208250291',
      displayLabel: 'yannickyyyy',
      verifiedAt: expect.any(String),
    })
    expect(store.saveUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'BG-10008' }))
  })
})
