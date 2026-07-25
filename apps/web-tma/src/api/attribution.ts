import { apiRequest } from './client'
import { getAttribution, adoptAttribution, type Attribution } from '@/utils/attribution'
import { isNativeApp } from '@/utils/pwa'

// 站外 APK 的归因桥：浏览器 localStorage 与 App WebView 隔离，落地页存的 betogo_attr
// 带不进 App。点下载时把快照交给服务端暂存，App 首启按 IP+机型 认领后写回本地，
// 之后注册照旧走 X-Attr 头，下游（bg_user_attribution / CAPI / BI）零改动。

const PAIR_DONE_KEY = 'betogo_attr_pair_done'

/** 浏览器侧：点 APK 下载时上报归因快照。自然流量无快照则没什么可递，直接跳过 */
export function reportApkDownloadClick(): void {
  const attr = getAttribution()
  if (!attr) return
  void apiRequest('/attribution/download-click', {
    method: 'POST',
    body: JSON.stringify({ attr }),
  }).catch(() => {})
}

/** App 侧：首启认领配对快照。只跑一次，网络失败下次启动重试 */
export async function pairApkAttribution(): Promise<void> {
  if (!isNativeApp()) return
  if (getAttribution()) return
  try {
    if (localStorage.getItem(PAIR_DONE_KEY)) return
  } catch { /* 读不了就当没跑过 */ }
  try {
    const res = await apiRequest<{ attr: Attribution | null }>('/attribution/app-first-open', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (res.attr) adoptAttribution(res.attr)
    // 请求成功即标记完成：窗口内没配上，重试也不会有新结果（下载必然发生在首启之前）
    localStorage.setItem(PAIR_DONE_KEY, '1')
  } catch { /* 网络失败不落标记，下次启动重试 */ }
}
