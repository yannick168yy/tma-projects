import type { AuthSession } from '@/types/api'

const MOCK_TOKEN = 'mock-session-token'

export async function mockTelegramLogin(initData: string): Promise<AuthSession> {
  await delay(600)
  if (!initData && !import.meta.env.DEV) {
    throw new Error('Missing Telegram initData')
  }
  return {
    token: MOCK_TOKEN,
    expiresIn: 86400,
    isNewUser: !localStorage.getItem('betogo_seen'),
    trialRedPacketEligible: !localStorage.getItem('betogo_trial_claimed'),
    user: {
      id: 'BG-10001',
      telegramUserId: 8842916,
      displayName: 'BetoGo Player',
      avatarUrl: undefined,
      inviteCode: 'BG8X2K',
      isNewUser: !localStorage.getItem('betogo_seen'),
    },
  }
}

export async function mockGoogleLogin(): Promise<AuthSession> {
  await delay(800)
  return {
    token: MOCK_TOKEN,
    expiresIn: 86400,
    isNewUser: false,
    user: {
      id: 'BG-G-20001',
      displayName: 'Google Player',
      inviteCode: 'BGG7Y1',
    },
  }
}

export async function mockRestoreSession(): Promise<AuthSession | null> {
  await delay(400)
  const token = localStorage.getItem('betogo_token')
  if (!token) return null
  return {
    token,
    expiresIn: 86400,
    isNewUser: false,
    trialRedPacketEligible: !localStorage.getItem('betogo_trial_claimed'),
    user: {
      id: 'BG-10001',
      displayName: 'BetoGo Player',
      inviteCode: 'BG8X2K',
    },
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
