/**
 * 版本自动刷新：部署频繁 + iOS/webview 会长时间缓存旧 SPA 会话，导致用户跑着旧代码
 * （表现为新功能拿不到数据、旧 bug 复现）。这里在页面回到前台时比对线上 index.html
 * 引用的主 bundle 是否变化，变了就整页刷新拿新代码。lazyWithReload 只能兜 chunk 404，
 * 这个补上「旧会话内部一致、不 404」的情况。
 */
function mainBundleHref(): string {
  const el = Array.from(document.querySelectorAll('script[type="module"]'))
    .map((s) => (s as HTMLScriptElement).src)
    .find((src) => /\/assets\/index-[\w-]+\.js/.test(src))
  return el ?? ''
}

export function initVersionAutoReload(): void {
  if (window.location.pathname !== '/kyc-setting') return
  const current = mainBundleHref()
  if (!current) return
  let checking = false
  async function check() {
    if (checking || document.visibilityState !== 'visible') return
    checking = true
    try {
      const res = await fetch(`/index.html?_=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const html = await res.text()
      const m = html.match(/\/assets\/index-[\w-]+\.js/)
      if (m) {
        const latest = new URL(m[0], location.origin).href
        if (latest !== current) location.reload()
      }
    } catch { /* 网络失败忽略 */ }
    finally { checking = false }
  }
  document.addEventListener('visibilitychange', () => { void check() })
  window.addEventListener('focus', () => { void check() })
  window.addEventListener('pageshow', () => { void check() })
  window.setTimeout(() => { void check() }, 3000)
}
