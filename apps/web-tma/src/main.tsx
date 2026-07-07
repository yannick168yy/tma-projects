import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import App from './App'
import { i18n } from '@/i18n'
import './styles/index.css'
import { preventDoubleTapZoom } from '@/utils/preventDoubleTapZoom'
import { initTelegramWebApp } from '@/utils/initTelegramWebApp'
import { captureReferralFromUrl } from '@/utils/referral'
import { initTheme } from '@/stores/theme'
import { initAnalytics } from '@/utils/analytics'
import { initPwa } from '@/utils/pwa'
import { initFingerprint } from '@/utils/fingerprint'

preventDoubleTapZoom()
captureReferralFromUrl()
initTelegramWebApp()
initTheme()
initAnalytics()
initPwa()
initFingerprint()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>,
)
