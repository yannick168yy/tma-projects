const STATE_KEY = 'betogo_google_oauth_state'

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

  const state = crypto.randomUUID()
  sessionStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function readStoredOAuthState(): string | null {
  return sessionStorage.getItem(STATE_KEY)
}

export function clearStoredOAuthState(): void {
  sessionStorage.removeItem(STATE_KEY)
}
