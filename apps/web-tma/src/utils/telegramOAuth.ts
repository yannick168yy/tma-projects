import { TELEGRAM_OIDC_CLIENT_ID } from '@/constants/telegram'
import { getStoredReferral } from '@/utils/referral'

const STATE_KEY = 'betogo_telegram_oauth_state'

interface OAuthState {
  nonce: string
  ref: string
}

export function getTelegramRedirectUri(): string {
  return `${window.location.origin}/auth/telegram/callback`
}

export function startTelegramLoginRedirect(): void {
  const nonce = crypto.randomUUID()
  const stateObj: OAuthState = { nonce, ref: getStoredReferral() ?? '' }
  localStorage.setItem(STATE_KEY, JSON.stringify(stateObj))

  // state 用纯不透明 nonce（非 JSON），避免被 Telegram 改写导致回跳校验失败
  const params = new URLSearchParams({
    client_id: TELEGRAM_OIDC_CLIENT_ID,
    redirect_uri: getTelegramRedirectUri(),
    response_type: 'code',
    scope: 'openid profile',
    state: nonce,
  })

  window.location.href = `https://oauth.telegram.org/auth?${params.toString()}`
}

function readStoredState(): OAuthState | null {
  const raw = localStorage.getItem(STATE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as OAuthState
  } catch {
    return null
  }
}

export function readStoredNonce(): string | null {
  return readStoredState()?.nonce ?? null
}

export function readStoredRef(): string {
  return readStoredState()?.ref ?? ''
}

export function clearStoredOAuthState(): void {
  localStorage.removeItem(STATE_KEY)
}
