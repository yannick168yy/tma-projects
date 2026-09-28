// RevoSurge Web Tracker。与 FB/TikTok 像素同策略：只有带 clickid 进站的买量流量
// 才加载，自然流量不装三方脚本。例外是投放落地页：对方审核 campaign 时直接打开裸链接
// 查 tracker，落地页本身也只承接投放流量，所以不看参数一律加载。
//
// 它与 S2S 的分工：转化事件（注册/充值/投注…）一律由服务端 S2S 上报，前端被拦截率高、
// 跳三方支付又常回不到站内，靠不住。这个脚本负责落地页侧的行为事件——对方的产品要收到
// Web Tracker 事件才算完整接入，campaign 的前置校验也看它。
//
// tracker ID 走环境变量而非写死：印度站等新站点各有各的 product，改配置不用发版。
import { getAttribution } from '@/utils/attribution'

declare global {
  interface Window {
    WebTracker?: new (opts: { trackerId: string; geo?: boolean }) => unknown
    __rsTracker?: unknown
  }
}

const TRACKER_ID = (import.meta.env.VITE_REVOSURGE_TRACKER_ID ?? '').trim()

export function initRevosurgeTracker(): void {
  if (!TRACKER_ID || window.__rsTracker) return
  // 归因快照里没有 clickid 即非 RevoSurge 流量
  if (!/^\/(in\/)?welcome\/?$/.test(window.location.pathname) && !getAttribution()?.rsc) return

  const s = document.createElement('script')
  s.src = 'https://assets.revosurge.com/js/web-tracker.js'
  s.async = true
  s.onload = () => {
    try {
      // geo 默认开启，会弹浏览器定位授权（iPhone 上尤其显眼、劝退注册）；归因不需要经纬度，关掉
      if (window.WebTracker) window.__rsTracker = new window.WebTracker({ trackerId: TRACKER_ID, geo: false })
    } catch {
      /* 归因失败不能影响进站 */
    }
  }
  document.head.appendChild(s)
}
