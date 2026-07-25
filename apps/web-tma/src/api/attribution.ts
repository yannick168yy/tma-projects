import { apiRequest } from './client'
import { getAttribution, adoptAttribution, type Attribution } from '@/utils/attribution'
import { isNativeApp, isIos, isStandalone } from '@/utils/pwa'

// 站外安装的归因桥：浏览器与 App 的存储互相隔离（Android APK 壳 WebView、iOS 主屏幕
// PWA 容器皆如此），落地页存的 betogo_attr 带不进去。点安装时把快照交给服务端暂存，
// App/PWA 首启按 IP+设备键 认领后写回本地，之后注册照旧走 X-Attr 头，
// 下游（bg_user_attribution / CAPI / BI）零改动。

const PAIR_DONE_KEY = 'betogo_attr_pair_done'

// 设备键必须在前端算，且同一台设备在「浏览器」和「装好的 App/PWA」两侧算出一致：
// - Android：Chrome 110+ 把 HTTP UA 冻结成 "Android 10; K"，服务端从请求头提机型配不上
//   WebView 真实机型，用 UA-CH 高熵接口取真实值（浏览器与壳 WebView 同为 Chromium）。
// - iOS：没有 UA-CH，UA 里也无机型（所有 iPhone 一样），用 iOS 主版本+屏幕尺寸+DPR 组合，
//   Safari 与主屏幕 PWA 读到的值相同。
async function computeDeviceKey(): Promise<string | null> {
  if (isIos()) {
    const m = /OS (\d+)_/.exec(navigator.userAgent)
    const w = Math.min(screen.width, screen.height)
    const h = Math.max(screen.width, screen.height)
    if (!w || !h) return null
    return `ios${m ? m[1] : '0'}|${w}x${h}x${window.devicePixelRatio || 1}`.slice(0, 128)
  }
  try {
    const uad = (navigator as { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ model?: string; platformVersion?: string }> } }).userAgentData
    if (uad?.getHighEntropyValues) {
      const v = await uad.getHighEntropyValues(['model', 'platformVersion'])
      const model = String(v.model ?? '').trim().toLowerCase()
      const major = String(v.platformVersion ?? '').split('.')[0]
      if (model && model !== 'k' && major) return `${major}|${model}`.slice(0, 128)
    }
  } catch { /* 无 UA-CH 时降级走 UA 正则 */ }
  const m = /Android ([\d.]+); ([^;)]+)/.exec(navigator.userAgent)
  if (!m) return null
  const model = m[2].replace(/ Build\/.*$/, '').trim().toLowerCase()
  if (!model || model === 'k') return null
  return `${m[1].split('.')[0]}|${model}`.slice(0, 128)
}

/**
 * 浏览器侧：点「安装」时上报归因快照（Android 点 APK 下载、iOS 弹添加到主屏引导）。
 * 自然流量无快照则没什么可递，直接跳过。
 */
export function reportInstallClick(): void {
  const attr = getAttribution()
  if (!attr) return
  void computeDeviceKey()
    .then((dk) => apiRequest('/attribution/download-click', {
      method: 'POST',
      body: JSON.stringify({ attr, dk }),
    }))
    .catch(() => {})
}

/** App/PWA 侧：首启认领配对快照。只跑一次，网络失败下次启动重试 */
export async function pairInstallAttribution(): Promise<void> {
  // Android APK 壳，或 iOS 主屏幕 PWA（Android PWA 与 Chrome 共享存储，无需配对）
  if (!isNativeApp() && !(isIos() && isStandalone())) return
  if (getAttribution()) return
  try {
    if (localStorage.getItem(PAIR_DONE_KEY)) return
  } catch { /* 读不了就当没跑过 */ }
  try {
    const dk = await computeDeviceKey().catch(() => null)
    const res = await apiRequest<{ attr: Attribution | null }>('/attribution/app-first-open', {
      method: 'POST',
      body: JSON.stringify({ dk }),
    })
    if (res.attr) adoptAttribution(res.attr)
    // 请求成功即标记完成：窗口内没配上，重试也不会有新结果（安装必然发生在首启之前）
    localStorage.setItem(PAIR_DONE_KEY, '1')
  } catch { /* 网络失败不落标记，下次启动重试 */ }
}
