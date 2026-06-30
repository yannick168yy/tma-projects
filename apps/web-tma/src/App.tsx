import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SplashPage from '@/views/SplashPage'
import GoogleAuthCallback from '@/views/GoogleAuthCallback'
import TelegramAuthCallback from '@/views/TelegramAuthCallback'
import AnalyticsPageTracker from '@/components/AnalyticsPageTracker'
import LoginSheet from '@/components/auth/LoginSheet'
import RedPacketSheet from '@/components/promotion/RedPacketSheet'
import TrialWelcomeSheet, { TRIAL_SHEET_SEEN_KEY } from '@/components/promotion/TrialWelcomeSheet'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'

const AppShell = lazy(() => import('@/views/AppShell'))

function MainApp() {
  const phase = useAuthStore((s) => s.phase)
  const bootError = useAuthStore((s) => s.bootError)
  const loginSheetOpen = useAuthStore((s) => s.loginSheetOpen)
  const closeLoginSheet = useAuthStore((s) => s.closeLoginSheet)
  const token = useAuthStore((s) => s.token)
  const trialEligible = useAuthStore((s) => s.trialEligible)
  const { redPacketSheet, closeRedPacket, trialClaiming, claimTrialIfEligible, promoConfig, loadPromoConfig } = usePromotionStore()

  const [trialWelcomeOpen, setTrialWelcomeOpen] = useState(false)
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    void useAuthStore.getState().bootstrap()
  }, [])

  useEffect(() => {
    if (phase !== 'ready' || !token || !trialEligible) return
    if (sessionStorage.getItem(TRIAL_SHEET_SEEN_KEY)) return
    if (!promoConfig) void loadPromoConfig() // 仅在试玩弹窗需要金额时才拉促销配置
    setTrialWelcomeOpen(true)
  }, [phase, token, trialEligible])

  function dismissTrialWelcome() {
    sessionStorage.setItem(TRIAL_SHEET_SEEN_KEY, '1')
    setTrialWelcomeOpen(false)
  }

  async function onTrialWelcomeClaim() {
    const result = await claimTrialIfEligible()
    if (result.ok || result.alreadyClaimed) dismissTrialWelcome()
  }

  if (phase === 'splash') return <SplashPage error={bootError} />

  return (
    <>
      <Suspense fallback={null}>
        <AppShell />
      </Suspense>
      <LoginSheet open={loginSheetOpen} onClose={closeLoginSheet} />
      {trialWelcomeOpen && (
        <TrialWelcomeSheet
          claiming={trialClaiming}
          onClaim={() => void onTrialWelcomeClaim()}
          onDismiss={dismissTrialWelcome}
          amount={promoConfig?.trial.amount}
        />
      )}
      {redPacketSheet.open && (
        <RedPacketSheet
          title={redPacketSheet.title}
          amountPhp={redPacketSheet.amountPhp}
          onClose={closeRedPacket}
        />
      )}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AnalyticsPageTracker />
      <Routes>
        <Route path="/auth/google/callback" element={<GoogleAuthCallback />} />
        <Route path="/auth/telegram/callback" element={<TelegramAuthCallback />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  )
}
