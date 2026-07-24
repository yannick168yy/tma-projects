import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import App from './App'
import { i18n } from '@/i18n'
import './styles/index.css'
import { preventDoubleTapZoom } from '@/utils/preventDoubleTapZoom'
import { initTelegramWebApp } from '@/utils/initTelegramWebApp'
import { captureReferralFromUrl } from '@/utils/referral'
import { captureAttributionFromUrl } from '@/utils/attribution'
import { initTheme } from '@/stores/theme'
import { initAnalytics } from '@/utils/analytics'
import { initPixels } from '@/utils/pixels'
import { initPwa } from '@/utils/pwa'
import { initFingerprint } from '@/utils/fingerprint'
import { initVersionAutoReload } from '@/utils/versionReload'

// Vite modulepreload 失败（部署后旧客户端引用的 chunk 已被覆盖删除）→ 自动整页刷新一次自愈，避免黑屏
window.addEventListener('vite:preloadError', () => {
  if (Date.now() - Number(sessionStorage.getItem('chunk_reload_ts') || '0') > 10_000) {
    sessionStorage.setItem('chunk_reload_ts', String(Date.now()))
    window.location.reload()
  }
})

preventDoubleTapZoom()
captureReferralFromUrl()
captureAttributionFromUrl() // 必须早于 initPixels：像素 ID 从归因快照里取
initTelegramWebApp()
initTheme()
initAnalytics()
initPixels()
initPwa()
initFingerprint()
initVersionAutoReload()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>,
)
