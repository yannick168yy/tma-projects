// FB / TikTok 广告像素。只有带像素 ID 进站的买量流量才会加载，自然流量不装脚本。
//
// 像素 ID 走投放链接 ?px= / ?tpx=（存在 attribution 快照里），不写死在构建产物中——
// 一条投放线一个像素，新增线路只改投放链接，不用发版。
//
// 与服务端 CAPI 的关系：注册用「浏览器 + 服务端」双打，靠同一个 eventID 去重，补浏览器
// 被拦截的量；充值 Purchase 只由服务端打，因为跳三方支付后用户常回不到站内，前端根本收不到。
import { getAttribution } from '@/utils/attribution'

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown }
    _fbq?: unknown
    ttq?: Record<string, unknown> & { track?: (...args: unknown[]) => void }
    TiktokAnalyticsObject?: string
  }
}

// 像素 ID 会被拼进第三方脚本调用，必须白名单字符，挡住 URL 参数注入
const ID_RE = /^[A-Za-z0-9]{6,32}$/

let fbPixelId = ''
let ttPixelId = ''

function loadFacebook(id: string): void {
  if (window.fbq) return
  /* eslint-disable */
  const n: any = (window.fbq = function (...args: unknown[]) {
    n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args)
  })
  if (!window._fbq) window._fbq = n
  n.push = n
  n.loaded = true
  n.version = '2.0'
  n.queue = []
  /* eslint-enable */
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://connect.facebook.net/en_US/fbevents.js'
  document.head.appendChild(s)
  window.fbq?.('init', id)
  window.fbq?.('track', 'PageView')
}

function loadTiktok(id: string): void {
  if (window.ttq) return
  /* eslint-disable */
  const w: any = window
  w.TiktokAnalyticsObject = 'ttq'
  const ttq: any = (w.ttq = w.ttq || [])
  ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie']
  ttq.setAndDefer = function (t: any, e: string) {
    t[e] = function (...args: unknown[]) {
      t.push([e, ...args])
    }
  }
  for (const m of ttq.methods) ttq.setAndDefer(ttq, m)
  ttq.load = function (e: string) {
    ttq._i = ttq._i || {}
    ttq._i[e] = []
    ttq._i[e]._u = 'https://analytics.tiktok.com/i18n/pixel/events.js'
    ttq._t = ttq._t || {}
    ttq._t[e] = +new Date()
    ttq._o = ttq._o || {}
    ttq._o[e] = {}
    const s = document.createElement('script')
    s.async = true
    s.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(e)}&lib=ttq`
    document.head.appendChild(s)
  }
  /* eslint-enable */
  ttq.load(id)
  ttq.page()
}

export function initPixels(): void {
  try {
    const attr = getAttribution()
    const fb = (attr?.px || import.meta.env.VITE_FB_PIXEL_ID || '').trim()
    const tt = (attr?.tpx || import.meta.env.VITE_TIKTOK_PIXEL_ID || '').trim()
    if (ID_RE.test(fb)) {
      fbPixelId = fb
      loadFacebook(fb)
    }
    if (ID_RE.test(tt)) {
      ttPixelId = tt
      loadTiktok(tt)
    }
  } catch {
    /* 像素永远不能阻断进站 */
  }
}

function fire(event: string, params: Record<string, unknown>, eventId: string): void {
  try {
    if (fbPixelId) window.fbq?.('track', event, params, { eventID: eventId })
    if (ttPixelId) window.ttq?.track?.(event, params, { event_id: eventId })
  } catch {
    /* 忽略像素异常 */
  }
}

export const pixels = {
  /** 注册成功。eventID 用 userId，与服务端 CAPI 同值去重 */
  registration(userId: string): void {
    fire('CompleteRegistration', {}, userId)
  },
  /** 充值下单（未到账）。到账的 Purchase 由服务端 CAPI 打 */
  checkoutStart(amount: number, currency: string, orderId?: string): void {
    fire('InitiateCheckout', { value: amount, currency }, orderId ?? `co_${Date.now()}`)
  },
}
