import { Suspense, useEffect, useRef } from 'react'
import { lazyWithReload } from '@/utils/lazyWithReload'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SplashPage from '@/views/SplashPage'
import GoogleAuthCallback from '@/views/GoogleAuthCallback'
import TelegramAuthCallback from '@/views/TelegramAuthCallback'
import AnalyticsPageTracker from '@/components/AnalyticsPageTracker'
import LoginSheet from '@/components/auth/LoginSheet'
import RedPacketSheet from '@/components/promotion/RedPacketSheet'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'

const AppShell = lazyWithReload(() => import('@/views/AppShell'))

function MainApp() {
  const phase = useAuthStore((s) => s.phase)
  const bootError = useAuthStore((s) => s.bootError)
  const loginSheetOpen = useAuthStore((s) => s.loginSheetOpen)
  const closeLoginSheet = useAuthStore((s) => s.closeLoginSheet)
  const { redPacketSheet, closeRedPacket } = usePromotionStore()

  const bootstrapped = useRef(false)

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    void useAuthStore.getState().bootstrap()
  }, [])

  if (phase === 'splash') return <SplashPage error={bootError} />

  return (
    <>
      <Suspense fallback={null}>
        <AppShell />
      </Suspense>
      <LoginSheet open={loginSheetOpen} onClose={closeLoginSheet} />
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
