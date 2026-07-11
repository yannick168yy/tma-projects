/**
 * Cloudflare Turnstile 人机验证。
 * 构建时注入 VITE_TURNSTILE_SITE_KEY 才启用；未配置时所有调用都是 no-op，
 * 与 bff 端 TURNSTILE_SECRET_KEY 成对配置（只配一边会导致注册被拒）。
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: {
    sitekey: string
    theme?: 'light' | 'dark' | 'auto'
    callback?: (token: string) => void
    'expired-callback'?: () => void
    'error-callback'?: () => void
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
