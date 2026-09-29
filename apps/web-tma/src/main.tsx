import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import './styles/index.css'
import { preventDoubleTapZoom } from '@/utils/preventDoubleTapZoom'
import { initTelegramWebApp } from '@/utils/initTelegramWebApp'
import { captureReferralFromUrl } from '@/utils/referral'
import { captureAttributionFromUrl, resolveShortLinkAttribution } from '@/utils/attribution'
import { initTheme } from '@/stores/theme'
import { initAnalytics } from '@/utils/analytics'
import { initPixels } from '@/utils/pixels'
import { initRevosurgeTracker } from '@/utils/revosurgeTracker'
import { initPwa } from '@/utils/pwa'
import { initFingerprint } from '@/utils/fingerprint'
import { initVersionAutoReload } from '@/utils/versionReload'
import { initSiteMarketConfig } from '@/config/market'
import { initNativeToken } from '@/utils/tokenStore'
import { initClientErrorReport, reportClientError } from '@/utils/clientErrorReport'
import AppErrorBoundary from '@/components/AppErrorBoundary'

// Vite modulepreload 失败（部署后旧客户端引用的 chunk 已被覆盖删除）→ 自动整页刷新一次自愈，避免黑屏
window.addEventListener('vite:preloadError', () => {
  if (Date.now() - Number(sessionStorage.getItem('chunk_reload_ts') || '0') > 10_000) {
    sessionStorage.setItem('chunk_reload_ts', String(Date.now()))
    window.location.reload()
  }
})

initClientErrorReport()
preventDoubleTapZoom()
initTheme()

// 落地页的代码块原本要等站点配置 → i18n → App 渲染后才开始下载，中间约 0.5s 空白；
// 路径已知时提前并行拉取（与 App.tsx 的 lazy import 同一模块，不会重复下载）
if (/^\/(welcome|in\/join|in\/welcome)\/?$/.test(window.location.pathname)) void import('@/views/IndiaLandingPage')

async function bootstrap() {
  await initTelegramWebApp()
  captureReferralFromUrl()
  initAnalytics()
  // App 切换备用域名后 Web 存储属于新 origin，先从 Android Keystore 恢复会话再初始化页面。
  await initNativeToken()
  // 配置请求与代码下载并行；i18n 等配置应用后再初始化，避免包网站点拿到错误品牌与语言。
  const configPromise = initSiteMarketConfig()
  const modulesPromise = Promise.all([import('./App'), import('@/i18n')])
  await configPromise
  const [{ default: App }, { i18n, initI18n }] = await modulesPromise
  await initI18n()
  // 短链 /t/<code> 落地：先换出归因（含像素 ID）并把地址清回首页，再装像素、再挂路由。
  // 非短链路径 resolve 立即返回，不引入任何延迟。
  // 顺序敏感：短链解析必须在普通参数捕获之前——短链 URL 上往往还挂着 fbclid，
  // 若先跑普通捕获会拿 fbclid 抢占 first-touch，短码换出的 c/px 就永远进不去了
  await resolveShortLinkAttribution()
  captureAttributionFromUrl() // 必须早于 initPixels：像素 ID 从归因快照里取
  initPixels()
  initRevosurgeTracker()
  initPwa()
  initVersionAutoReload()

  createRoot(document.getElementById('app')!).render(
    <StrictMode>
      <AppErrorBoundary>
        <I18nextProvider i18n={i18n}>
          <App />
        </I18nextProvider>
      </AppErrorBoundary>
    </StrictMode>,
  )
  window.setTimeout(() => void initFingerprint(), 0)
}

bootstrap().catch((e) => reportClientError('bootstrap', e))
