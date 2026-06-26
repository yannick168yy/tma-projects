import { apiRequest, getInitData } from '@/api/client'
import * as mock from '@/api/mock/auth.mock'
import { getGoogleRedirectUri, startGoogleLoginRedirect } from '@/utils/googleOAuth'
import { getTelegramRedirectUri, startTelegramLoginRedirect } from '@/utils/telegramOAuth'
import type { AuthSession, AuthUser, LoginProvider, PasswordMethod, TelegramWidgetUser } from '@/types/api'

const useMock = import.meta.env.VITE_USE_MOCK_API !== 'false'

/** 本地标记：试玩红包已领取/无资格，置位后恢复会话时跳过 /promotions/trial-play 请求 */
export const TRIAL_CLAIMED_KEY = 'betogo_trial_claimed'

interface MeResponse {
  id: string
  telegramUserId?: number
  telegramUsername?: string
  username?: string
  displayName: string
  avatarUrl?: string
  inviteCode?: string
  loginProvider?: LoginProvider
  email?: string
  phone?: string
  boundTelegram?: boolean
  boundGoogle?: boolean
  boundPhone?: boolean
  boundAccount?: boolean
  isAgent?: boolean
}

function toAuthUser(me: MeResponse): AuthUser {
  return {
    id: me.id,
    telegramUserId: me.telegramUserId,
    telegramUsername: me.telegramUsername,
    username: me.username,
    displayName: me.displayName,
    avatarUrl: me.avatarUrl,
    inviteCode: me.inviteCode,
    loginProvider: me.loginProvider,
    email: me.email,
    phone: me.phone,
    boundTelegram: me.boundTelegram,
    boundGoogle: me.boundGoogle,
    boundPhone: me.boundPhone,
    boundAccount: me.boundAccount,
    isAgent: me.isAgent,
  }
}

export async function loginTelegramWidget(data: TelegramWidgetUser): Promise<AuthSession> {
  return apiRequest<AuthSession>('/auth/telegram-widget', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function bindTelegramOidc(code: string, redirectUri: string): Promise<{ user: AuthUser }> {
  return apiRequest('/user/bind/telegram-oidc', { method: 'POST', body: JSON.stringify({ code, redirectUri }) })
}

export async function bindGoogle(code: string, redirectUri: string): Promise<{ user: AuthUser }> {
  return apiRequest('/user/bind/google', { method: 'POST', body: JSON.stringify({ code, redirectUri }) })
}

export async function bindPhone(phone: string, password?: string): Promise<{ user: AuthUser }> {
  return apiRequest('/user/bind/phone', { method: 'POST', body: JSON.stringify({ phone, password }) })
}

export async function bindAccount(username: string, password: string): Promise<{ user: AuthUser }> {
  return apiRequest('/user/bind/account', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export async function loginTelegram(): Promise<AuthSession> {
  if (useMock) return mock.mockTelegramLogin(getInitData())
  const data = await apiRequest<AuthSession>('/auth/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': getInitData() },
    body: JSON.stringify({ initData: getInitData() }),
  })
  return data
}

/** Redirects browser to Google OAuth (non-TG web only). */
export function loginWithGoogleRedirect(): void {
  if (useMock) {
    void mock.mockGoogleLogin().then((session) => {
      localStorage.setItem('betogo_token', session.token)
      window.location.reload()
    })
    return
  }
  startGoogleLoginRedirect()
}

export async function completeGoogleLogin(code: string, redirectUri?: string, referralCode?: string): Promise<AuthSession> {
  if (useMock) return mock.mockGoogleLogin()
  return apiRequest<AuthSession>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({
      code,
      redirectUri: redirectUri ?? getGoogleRedirectUri(),
      referralCode: referralCode || undefined,
    }),
  })
}

/** Redirects browser to Telegram OIDC login (non-TG web only). */
export function loginWithTelegramRedirect(): void {
  startTelegramLoginRedirect()
}

export async function completeTelegramLogin(code: string, redirectUri?: string, referralCode?: string): Promise<AuthSession> {
  return apiRequest<AuthSession>('/auth/telegram-oidc', {
    method: 'POST',
    body: JSON.stringify({
      code,
      redirectUri: redirectUri ?? getTelegramRedirectUri(),
      referralCode: referralCode || undefined,
    }),
  })
}

export async function registerPassword(
  method: PasswordMethod,
  identifier: string,
  password: string,
  referralCode?: string,
): Promise<AuthSession> {
  return apiRequest<AuthSession>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ method, identifier, password, referralCode: referralCode || undefined }),
  })
}

export async function loginPassword(
  method: PasswordMethod,
  identifier: string,
  password: string,
): Promise<AuthSession> {
  return apiRequest<AuthSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ method, identifier, password }),
  })
}

export async function sendForgotPasswordOtp(phone: string): Promise<{ phone: string; resendInSec: number }> {
  return apiRequest('/auth/forgot-password/send-otp', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
}

export async function resetForgotPassword(phone: string, code: string, password: string): Promise<null> {
  return apiRequest('/auth/forgot-password/reset', {
    method: 'POST',
    body: JSON.stringify({ phone, code, password }),
  })
}

export async function logoutSession(): Promise<void> {
  if (useMock) return
  try {
    await apiRequest<null>('/auth/logout', { method: 'POST' })
  } catch {
    // Session may already be invalid
  }
}

export async function restoreSession(): Promise<AuthSession | null> {
  if (useMock) return mock.mockRestoreSession()
  const token = localStorage.getItem('betogo_token')
  if (!token) return null
  try {
    const trialClaimed = localStorage.getItem(TRIAL_CLAIMED_KEY) === '1'
    const [session, me, trial] = await Promise.all([
      apiRequest<{ valid: boolean; userId?: string; expiresAt?: string }>('/auth/session'),
      apiRequest<MeResponse>('/user/me'),
      trialClaimed
        ? Promise.resolve({ claimed: true })
        : apiRequest<{ claimed: boolean }>('/promotions/trial-play').catch(() => ({ claimed: true })),
    ])
    if (!session.valid) return null
    return {
      token,
      expiresIn: 0,
      isNewUser: false,
      trialRedPacketEligible: !trial.claimed,
      user: toAuthUser(me),
    }
  } catch {
    return null
  }
}
