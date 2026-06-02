import { useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppShell from '@/views/AppShell'
import SplashPage from '@/views/SplashPage'
import GoogleAuthCallback from '@/views/GoogleAuthCallback'
import LoginSheet from '@/components/auth/LoginSheet'
import RedPacketSheet from '@/components/promotion/RedPacketSheet'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'

function MainApp() {
  const { phase, bootError, loginSheetOpen, closeLoginSheet } = useAuthStore()
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
      <AppShell />
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
      <Routes>
        <Route path="/auth/google/callback" element={<GoogleAuthCallback />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  )
}
