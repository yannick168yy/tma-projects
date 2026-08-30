import { clearNativeToken, persistNativeToken, restoreNativeToken } from './nativeSession'

// 会话 token 的持久化。iOS 从主屏 PWA 拉起 Google/Telegram 授权后整页回跳时,
// standalone webview 的 localStorage 可能读不回刚写入的 token(与 OAuth state 丢失同源),
// 导致登录后仍判定未登录、反复弹登录 → 死循环。用 SameSite=Lax cookie 做镜像兜底:
// cookie 会随顶层回跳存活,localStorage 丢了也能恢复。两处任一有值即视为已登录。
const TOKEN_KEY = 'betogo_token'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 天

function readCookie(): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + TOKEN_KEY + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

export function getToken(): string | null {
  try {
    const v = localStorage.getItem(TOKEN_KEY)
    if (v) return v
  } catch { /* localStorage 不可用时退回 cookie */ }
  return readCookie()
}

export function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* 忽略,cookie 兜底 */ }
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`
  persistNativeToken(token)
}

export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* 忽略 */ }
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`
  clearNativeToken()
}

export async function initNativeToken(): Promise<void> {
  if (getToken()) return
  const token = await restoreNativeToken()
  if (!token) return
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* cookie 兜底 */ }
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`
}
