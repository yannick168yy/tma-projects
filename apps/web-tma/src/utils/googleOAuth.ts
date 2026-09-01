import { getStoredReferral } from '@/utils/referral'
import { isNativeApp } from '@/utils/pwa'
import { getSiteMarket } from '@/config/market'

const STATE_KEY = 'betogo_google_oauth_state'

interface OAuthState {
  nonce: string
  ref: string
  /** 发起登录的线路域名；借道注册域名完成 OAuth 时用它跳回来 */
  origin?: string
  intent?: 'bind'
}

// 必须与 apps/android-shell/.../AndroidManifest.xml 的 App Link 注册列表一致：
// 只有这些 host 上的 /auth/ 回跳才会被系统交回 App。列表是编译进 APK 的，
// 后台新配的线路域名一定不在其中。
const APP_LINK_HOSTS = new Set([
  'betogo.app', 'www.betogo.games', 'betogo666.com', 'betogo777.com',
  'betogo.xyz', 'betogo.vip', 'www.188facai.com',
])

const APP_LINK_ORIGIN: Record<'PH' | 'ID', string> = {
  PH: 'https://www.betogo.games',
  ID: 'https://betogo.app',
}

/**
 * OAuth 要落在哪个域名。App 跑在未注册 App Link 的线路域名上时借道注册域名 ——
 * 否则 Google 回跳不会被交回 App，登录态留在 Custom Tab 里，WebView 仍是未登录。
 * 会话 token 存在原生 SessionVault（与域名无关），所以跨域回来不会掉登录态。
 * 浏览器/PWA 不受 App Link 影响，一律用当前域名。
 */
export function getGoogleAuthOrigin(): string {
  const origin = window.location.origin
  if (!isNativeApp() || APP_LINK_HOSTS.has(window.location.hostname)) return origin
  return APP_LINK_ORIGIN[getSiteMarket()]
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
  // 回调页跑在借道域名上时，这里算出的仍是它自己，换 code 时与授权请求天然一致。
  return `${getGoogleAuthOrigin()}/auth/google/callback`
}

export function startGoogleLoginRedirect(intent?: 'bind'): void {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('Google Client ID is not configured')
  }

  const origin = window.location.origin
  const stateObj: OAuthState = {
    nonce: crypto.randomUUID(),
    ref: getStoredReferral() ?? '',
  }
  // 借道时 localStorage / sessionStorage / cookie 全都跨不过去，回跳目标和绑定意图
  // 只能塞进 state 由 Google 原样带回。
  if (getGoogleAuthOrigin() !== origin) {
    stateObj.origin = origin
    if (intent === 'bind') stateObj.intent = 'bind'
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

/** 从 Google 原样带回的 state 里读出回跳目标和绑定意图（借道登录时唯一的传递通道） */
export function parseOAuthState(state: string | null): OAuthState | null {
  if (!state) return null
  try {
    const obj = JSON.parse(state) as OAuthState
    return typeof obj?.nonce === 'string' ? obj : null
  } catch {
    return null
  }
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
