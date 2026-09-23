// RevoSurge Web Tracker。与 FB/TikTok 像素同策略：只有带 click_id 进站的买量流量
// 才加载，自然流量不装三方脚本。
//
// 它与 S2S 的分工：转化事件（注册/充值/投注…）一律由服务端 S2S 上报，前端被拦截率高、
// 跳三方支付又常回不到站内，靠不住。这个脚本负责落地页侧的行为事件——对方的产品要收到
// Web Tracker 事件才算完整接入，campaign 的前置校验也看它。
//
// tracker ID 走环境变量而非写死：印度站等新站点各有各的 product，改配置不用发版。
import { getAttribution } from '@/utils/attribution'

declare global {
  interface Window {
    WebTracker?: new (opts: { trackerId: string }) => unknown
    __rsTracker?: unknown
  }
}

const TRACKER_ID = (import.meta.env.VITE_REVOSURGE_TRACKER_ID ?? '').trim()

export function initRevosurgeTracker(): void {
  if (!TRACKER_ID || window.__rsTracker) return
  // 归因快照里没有 click_id 即非 RevoSurge 流量
  if (!getAttribution()?.rsc) return

  const s = document.createElement('script')
  s.src = 'https://assets.revosurge.com/js/web-tracker.js'
  s.async = true
  s.onload = () => {
    try {
      if (window.WebTracker) window.__rsTracker = new window.WebTracker({ trackerId: TRACKER_ID })
    } catch {
      /* 归因失败不能影响进站 */
    }
  }
  document.head.appendChild(s)
}
