import { Suspense, useEffect, useRef } from 'react'
import { lazyWithReload } from '@/utils/lazyWithReload'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SplashPage from '@/views/SplashPage'
import GoogleAuthCallback from '@/views/GoogleAuthCallback'
import TelegramAuthCallback from '@/views/TelegramAuthCallback'
import AnalyticsPageTracker from '@/components/AnalyticsPageTracker'
import MaintenanceOverlay from '@/components/MaintenanceOverlay'
import BootSplash from '@/components/BootSplash'
import LoginSheet from '@/components/auth/LoginSheet'
import RedPacketSheet from '@/components/promotion/RedPacketSheet'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'
import { prewarmTurnstile } from '@/utils/turnstile'
import { isIos, isStandalone } from '@/utils/pwa'
import { pairInstallAttribution } from '@/api/attribution'

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
    // APK 壳 / iOS 主屏 PWA 首启：向服务端认领点安装时暂存的归因快照（浏览器与 App 存储隔离）
    void pairInstallAttribution()
    // iOS PWA:登录框首次渲染 Turnstile 会撑爆 webview 崩溃退回首页,提前在最小 DOM 里预热一次规避
    if (isIos() && isStandalone()) {
      const warm = () => prewarmTurnstile()
      if ('requestIdleCallback' in window) (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(warm)
      else setTimeout(warm, 3000)
    }
  }, [])

  if (phase === 'splash') {
    return (
      <>
        <BootSplash />
        <SplashPage error={bootError} />
      </>
    )
  }

  return (
    <>
      <BootSplash />
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
      <MaintenanceOverlay />
      <Routes>
        <Route path="/auth/google/callback" element={<GoogleAuthCallback />} />
        <Route path="/auth/telegram/callback" element={<TelegramAuthCallback />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  )
}
