import { apiRequest, getInitData } from '@/api/client'
import * as mock from '@/api/mock/auth.mock'
import { getGoogleRedirectUri, startGoogleLoginRedirect } from '@/utils/googleOAuth'
import type { AuthSession, AuthUser, LoginProvider, UserProfile } from '@/types/api'

const useMock = import.meta.env.VITE_USE_MOCK_API !== 'false'

interface MeResponse {
  id: string
  telegramUserId?: number
  telegramUsername?: string
  displayName: string
  avatarUrl?: string
  inviteCode?: string
  loginProvider?: LoginProvider
  email?: string
  profile?: UserProfile
}

function toAuthUser(me: MeResponse): AuthUser {
  return {
    id: me.id,
    telegramUserId: me.telegramUserId,
    telegramUsername: me.telegramUsername,
    displayName: me.displayName,
    avatarUrl: me.avatarUrl,
    inviteCode: me.inviteCode,
    loginProvider: me.loginProvider,
    email: me.email,
    profile: me.profile,
  }
}

export async function patchProfile(profile: Partial<UserProfile>): Promise<UserProfile> {
  const res = await apiRequest<{ profile: UserProfile }>('/user/me', {
    method: 'PATCH',
    body: JSON.stringify(profile),
  })
  return res.profile
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

export async function completeGoogleLogin(code: string, redirectUri?: string): Promise<AuthSession> {
  if (useMock) return mock.mockGoogleLogin()
  return apiRequest<AuthSession>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({
      code,
      redirectUri: redirectUri ?? getGoogleRedirectUri(),
    }),
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
    const session = await apiRequest<{ valid: boolean; userId?: string; expiresAt?: string }>(
      '/auth/session',
    )
    if (!session.valid) return null
    const me = await apiRequest<MeResponse>('/user/me')
    const trial = await apiRequest<{ claimed: boolean }>('/promotions/trial-play').catch(() => ({
      claimed: true,
    }))
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
