import { Suspense, useEffect } from 'react'
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
import { pairInstallAttribution } from '@/api/attribution'

const AppShell = lazyWithReload(() => import('@/views/AppShell'))
const IndiaLandingPage = lazyWithReload(() => import('@/views/IndiaLandingPage'))

// 模块级：落地页（IndiaLandingApp）跳进主站（MainApp）是换路由元素、不是整页刷新，
// 组件级 ref 会让主站再跑一遍 bootstrap —— phase 回到 splash、会话/余额/活动全部重拉
let bootstrapped = false

function useAppBootstrap() {
  useEffect(() => {
    if (bootstrapped) return
    bootstrapped = true
    void useAuthStore.getState().bootstrap()
    // APK 壳 / iOS 主屏 PWA 首启：向服务端认领点安装时暂存的归因快照（浏览器与 App 存储隔离）
    void pairInstallAttribution()
    // 不在这里预热 Turnstile：跨域 iframe 会导致部分 iOS PWA 冷启动白屏，登录组件按需加载。
  }, [])
}

function MainApp() {
  const phase = useAuthStore((s) => s.phase)
  const bootError = useAuthStore((s) => s.bootError)
  const loginSheetOpen = useAuthStore((s) => s.loginSheetOpen)
  const closeLoginSheet = useAuthStore((s) => s.closeLoginSheet)
  const { redPacketSheet, closeRedPacket } = usePromotionStore()

  useAppBootstrap()

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
          amount={redPacketSheet.amount}
          currency={redPacketSheet.currency}
          onClose={closeRedPacket}
        />
      )}
    </>
  )
}

function IndiaLandingApp() {
  const phase = useAuthStore((s) => s.phase)
  const bootError = useAuthStore((s) => s.bootError)
  const loginSheetOpen = useAuthStore((s) => s.loginSheetOpen)
  const closeLoginSheet = useAuthStore((s) => s.closeLoginSheet)

  useAppBootstrap()

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
        <IndiaLandingPage />
      </Suspense>
      <LoginSheet open={loginSheetOpen} onClose={closeLoginSheet} />
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
        <Route path="/welcome" element={<IndiaLandingApp />} />
        <Route path="/in/join" element={<IndiaLandingApp />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  )
}
