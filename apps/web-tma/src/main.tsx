import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { TonConnectUIProvider } from '@tonconnect/ui-react'
import App from './App'
import { i18n } from '@/i18n'
import './styles/index.css'
import { preventDoubleTapZoom } from '@/utils/preventDoubleTapZoom'
import { initTelegramWebApp } from '@/utils/initTelegramWebApp'
import { captureReferralFromUrl } from '@/utils/referral'
import { initTheme } from '@/stores/theme'

// 临时诊断：把 JS 运行时错误直接显示到屏幕（用于排查 iOS 黑屏，定位后移除）
;(() => {
  const show = (msg: string) => {
    let el = document.getElementById('__diag_err')
    if (!el) {
      el = document.createElement('div')
      el.id = '__diag_err'
      el.style.cssText =
        'position:fixed;inset:0;z-index:99999;background:#fff;color:#c00;font:12px/1.5 ui-monospace,monospace;padding:16px;white-space:pre-wrap;overflow:auto'
      ;(document.body || document.documentElement).appendChild(el)
    }
    el.textContent = (el.textContent || '') + msg + '\n\n'
  }
  window.addEventListener('error', (e) => {
    const err = (e as ErrorEvent).error
    show('ERROR: ' + (err?.stack || (e as ErrorEvent).message || String(e)))
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason
    show('REJECT: ' + (r?.stack || r?.message || String(r)))
  })
})()

try {
  preventDoubleTapZoom()
  captureReferralFromUrl()
  initTelegramWebApp()
  initTheme()
} catch (err) {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:#fff;color:#c00;font:12px/1.5 ui-monospace,monospace;padding:16px;white-space:pre-wrap;overflow:auto'
  el.textContent = 'INIT ERROR: ' + ((err as Error)?.stack || String(err))
  document.body.appendChild(el)
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <TonConnectUIProvider manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}>
        <App />
      </TonConnectUIProvider>
    </I18nextProvider>
  </StrictMode>,
)
