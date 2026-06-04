import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppShell from '@/views/AppShell'
import SplashPage from '@/views/SplashPage'
import GoogleAuthCallback from '@/views/GoogleAuthCallback'
import LoginSheet from '@/components/auth/LoginSheet'
import RedPacketSheet from '@/components/promotion/RedPacketSheet'
import TrialWelcomeSheet, { TRIAL_SHEET_SEEN_KEY } from '@/components/promotion/TrialWelcomeSheet'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'

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
    void loadPromoConfig()
  }, [])

  useEffect(() => {
    if (phase !== 'ready' || !token || !trialEligible) return
    if (sessionStorage.getItem(TRIAL_SHEET_SEEN_KEY)) return
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
      <AppShell />
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
      <Routes>
        <Route path="/auth/google/callback" element={<GoogleAuthCallback />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  )
}
