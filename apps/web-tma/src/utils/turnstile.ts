/**
 * Cloudflare Turnstile 人机验证。
 * 构建时注入 VITE_TURNSTILE_SITE_KEY 才启用；未配置时所有调用都是 no-op，
 * 与 bff 端 TURNSTILE_SECRET_KEY 成对配置（只配一边会导致注册被拒）。
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: {
    sitekey: string
    theme?: 'light' | 'dark' | 'auto'
    retry?: 'auto' | 'never'
    'retry-interval'?: number
    callback?: (token: string) => void
    'expired-callback'?: () => void
    'timeout-callback'?: () => void
    // Turnstile 会把错误码作为参数传入 error-callback(如 '110200' 域名未授权)
    'error-callback'?: (code?: string) => void
  }) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || ''

let scriptPromise: Promise<TurnstileApi> | null = null

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('turnstile load failed'))
    }
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('turnstile load failed'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

let prewarmed = false

/**
 * iOS standalone PWA 里,Turnstile 首个跨域 iframe / WASM 冷启动会撑爆 WKWebView 渲染进程
 * → 白屏退回首页;崩溃重载后资源已缓存,第二次就稳。
 * 这里只提前加载 api.js —— 它会自建管理 iframe 把 challenges.cloudflare.com 的核心/WASM
 * 预热进 webview 进程,但【不渲染】那只危险的可视 widget,零崩溃风险。目的是让用户之后在
 * 登录 sheet 里的真实渲染时进程已是「热」的,规避冷启动崩溃。失败静默忽略。
 * 注意:刻意不渲染隐藏 widget —— 若隐藏渲染也崩,会变成每次启动崩溃的死循环,比现状更糟。
 */
export function prewarmTurnstile(): void {
  if (prewarmed || !TURNSTILE_SITE_KEY) return
  prewarmed = true
  loadTurnstile().catch(() => { /* ignore */ })
}
