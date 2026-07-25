import { apiRequest } from './client'
import { getAttribution, adoptAttribution, type Attribution } from '@/utils/attribution'
import { isNativeApp } from '@/utils/pwa'

// 站外 APK 的归因桥：浏览器 localStorage 与 App WebView 隔离，落地页存的 betogo_attr
// 带不进 App。点下载时把快照交给服务端暂存，App 首启按 IP+设备键 认领后写回本地，
// 之后注册照旧走 X-Attr 头，下游（bg_user_attribution / CAPI / BI）零改动。

const PAIR_DONE_KEY = 'betogo_attr_pair_done'

// Chrome 110+ 把 HTTP UA 冻结成 "Android 10; K"，服务端从请求头提机型已不可靠（配不上
// WebView 侧的真实机型）。改为两侧都在前端用 UA-CH 高熵接口现算设备键随请求体上报——
// 浏览器与壳 WebView 同为 Chromium，同一台设备两侧算出的键必然一致。
async function computeDeviceKey(): Promise<string | null> {
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

/** 浏览器侧：点 APK 下载时上报归因快照。自然流量无快照则没什么可递，直接跳过 */
export function reportApkDownloadClick(): void {
  const attr = getAttribution()
  if (!attr) return
  void computeDeviceKey()
    .then((dk) => apiRequest('/attribution/download-click', {
      method: 'POST',
      body: JSON.stringify({ attr, dk }),
    }))
    .catch(() => {})
}

/** App 侧：首启认领配对快照。只跑一次，网络失败下次启动重试 */
export async function pairApkAttribution(): Promise<void> {
  if (!isNativeApp()) return
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
    // 请求成功即标记完成：窗口内没配上，重试也不会有新结果（下载必然发生在首启之前）
    localStorage.setItem(PAIR_DONE_KEY, '1')
  } catch { /* 网络失败不落标记，下次启动重试 */ }
}
