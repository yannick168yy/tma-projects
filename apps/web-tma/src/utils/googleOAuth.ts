import { getStoredReferral } from '@/utils/referral'

const STATE_KEY = 'betogo_google_oauth_state'

interface OAuthState {
  nonce: string
  ref: string
}

export function getGoogleRedirectUri(): string {
  const configured = import.meta.env.VITE_GOOGLE_REDIRECT_URI
  if (configured) return configured
  return `${window.location.origin}/auth/google/callback`
}

export function startGoogleLoginRedirect(): void {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('Google Client ID is not configured')
  }

  const stateObj: OAuthState = {
    nonce: crypto.randomUUID(),
    ref: getStoredReferral() ?? '',
  }
  const stateStr = JSON.stringify(stateObj)
  localStorage.setItem(STATE_KEY, stateStr)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state: stateStr,
    access_type: 'online',
    prompt: 'select_account',
  })

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
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
