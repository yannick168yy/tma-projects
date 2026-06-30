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
import { initAnalytics } from '@/utils/analytics'

preventDoubleTapZoom()
captureReferralFromUrl()
initTelegramWebApp()
initTheme()
initAnalytics()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <TonConnectUIProvider manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}>
        <App />
      </TonConnectUIProvider>
    </I18nextProvider>
  </StrictMode>,
)
