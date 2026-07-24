import { getStoredReferral } from '@/utils/referral'

const STATE_KEY = 'betogo_google_oauth_state'

interface OAuthState {
  nonce: string
  ref: string
}

// iOS 从主屏 PWA(standalone)拉起 Google 授权时,跳转/回跳会丢掉 webview 里的 localStorage,
// 回调读不到 state 就误报"登录校验失败"。用 SameSite=Lax 短期 cookie 兜底:cookie 会随顶层
// GET 回跳一起带回,localStorage 丢了也能从 cookie 恢复出 state。
function setStateCookie(value: string): void {
  document.cookie = `${STATE_KEY}=${encodeURIComponent(value)}; path=/; max-age=600; SameSite=Lax`
}

function readStateCookie(): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + STATE_KEY + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

function clearStateCookie(): void {
  document.cookie = `${STATE_KEY}=; path=/; max-age=0; SameSite=Lax`
}

export function getGoogleRedirectUri(): string {
  // 一份 bundle 部署到多个域名(测试 188facai / 生产 betogo.games),redirect 必须随当前域名走。
  // 不再读构建时烤死的 VITE_GOOGLE_REDIRECT_URI,否则生产会带着测试域名回跳。与 telegramOAuth 保持一致。
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
  setStateCookie(stateStr)

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
  return localStorage.getItem(STATE_KEY) ?? readStateCookie()
}

/** 返回的 state 是否是我们自己生成的合法结构(iOS PWA 双存都丢时的最后兜底校验) */
export function isWellFormedOAuthState(state: string): boolean {
  try {
    const obj = JSON.parse(state) as OAuthState
    return typeof obj?.nonce === 'string' && obj.nonce.length > 0 && typeof obj.ref === 'string'
  } catch {
    return false
  }
}

export function clearStoredOAuthState(): void {
  localStorage.removeItem(STATE_KEY)
  clearStateCookie()
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
