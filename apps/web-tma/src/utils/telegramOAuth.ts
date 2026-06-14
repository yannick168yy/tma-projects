import { TELEGRAM_OIDC_CLIENT_ID } from '@/constants/telegram'
import { getStoredReferral } from '@/utils/referral'

const STATE_KEY = 'betogo_telegram_oauth_state'

interface OAuthState {
  nonce: string
  ref: string
}

export function getTelegramRedirectUri(): string {
  const configured = import.meta.env.VITE_TELEGRAM_OIDC_REDIRECT_URI
  if (configured) return configured
  return `${window.location.origin}/auth/telegram/callback`
}

export function startTelegramLoginRedirect(): void {
  const stateObj: OAuthState = {
    nonce: crypto.randomUUID(),
    ref: getStoredReferral() ?? '',
  }
  const stateStr = JSON.stringify(stateObj)
  localStorage.setItem(STATE_KEY, stateStr)

  const params = new URLSearchParams({
    client_id: TELEGRAM_OIDC_CLIENT_ID,
    redirect_uri: getTelegramRedirectUri(),
    response_type: 'code',
    scope: 'openid profile',
    state: stateStr,
  })

  window.location.href = `https://oauth.telegram.org/auth?${params.toString()}`
}

export function readStoredOAuthState(): string | null {
  return localStorage.getItem(STATE_KEY)
}

export function clearStoredOAuthState(): void {
  localStorage.removeItem(STATE_KEY)
}

/** 从存储的 OAuth state JSON 中提取邀请码（可能为空字符串） */
export function extractRefFromOAuthState(storedState: string): string {
  try {
    const obj = JSON.parse(storedState) as OAuthState
    return obj.ref ?? ''
  } catch {
    return ''
  }
}
