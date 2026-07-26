// 买量归因采集：把落地时的广告来源钉死在设备上，注册时随请求头交给后端入库，
// 作为 FB/TikTok 投放按首存结算的唯一依据。
//
// first-touch 语义：第一次带参进站即写死，后续再带参不覆盖。理由是投手按「首存」结算，
// 用户从 A 渠道进来注册、几天后从 B 渠道回访，这单仍归 A。
//
// 存储与 deviceId 同策略：localStorage + cookie 双写。Google/Telegram OAuth 往返在
// iOS 上会丢 localStorage（见 turnstile/PWA 那一坑），cookie 是唯一能扛住往返的兜底。
const ATTR_KEY = 'betogo_attr'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90 // 90 天，覆盖广告平台默认归因窗口

export interface Attribution {
  /** 结算渠道标识，取自 ?c=，缺失时退回 utm_source */
  c?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  /** facebook / tiktok / google / other */
  plat?: string
  /** fbclid / ttclid / gclid 原值 */
  clid?: string
  /** 落地页 host + path，投放专用域名靠这个区分 */
  lh?: string
  lp?: string
  ref?: string
  /** 该条线的 FB / TikTok 像素 ID，由投放链接 ?px= / ?tpx= 带入，新增线路免发版 */
  px?: string
  tpx?: string
  /** 首访时间戳（秒），合成 _fbc 用 */
  ts?: number
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
}

function load(): Attribution | null {
  let raw = ''
  try {
    raw = localStorage.getItem(ATTR_KEY) || readCookie(ATTR_KEY) || ''
  } catch {
    raw = readCookie(ATTR_KEY) || ''
  }
  if (!raw) return null
  try {
    return JSON.parse(raw) as Attribution
  } catch {
    return null
  }
}

function save(attr: Attribution): void {
  const raw = JSON.stringify(attr)
  try {
    localStorage.setItem(ATTR_KEY, raw)
  } catch {
    /* 隐私模式下写不进去，靠 cookie 兜底 */
  }
  writeCookie(ATTR_KEY, raw)
}

function trim(v: string | null, max: number): string | undefined {
  const s = v?.trim()
  return s ? s.slice(0, max) : undefined
}

/** 有任一广告参数才算一次「有来源」的落地，纯直访不写存储、不占 first-touch 名额 */
export function captureAttributionFromUrl(): void {
  try {
    const url = new URL(window.location.href)
    const q = url.searchParams
    const fbclid = trim(q.get('fbclid'), 255)
    const ttclid = trim(q.get('ttclid'), 255)
    const gclid = trim(q.get('gclid'), 255)
    const attr: Attribution = {
      c: trim(q.get('c'), 64) ?? trim(q.get('utm_source'), 64),
      utm_source: trim(q.get('utm_source'), 128),
      utm_medium: trim(q.get('utm_medium'), 128),
      utm_campaign: trim(q.get('utm_campaign'), 191),
      utm_content: trim(q.get('utm_content'), 191),
      utm_term: trim(q.get('utm_term'), 191),
      plat: fbclid ? 'facebook' : ttclid ? 'tiktok' : gclid ? 'google' : undefined,
      clid: fbclid ?? ttclid ?? gclid,
      lh: url.hostname.slice(0, 191),
      lp: url.pathname.slice(0, 255),
      ref: trim(document.referrer, 255),
      px: trim(q.get('px'), 32),
      tpx: trim(q.get('tpx'), 32),
      ts: Math.floor(Date.now() / 1000),
    }
    if (!attr.c && !attr.clid && !attr.utm_campaign && !attr.px && !attr.tpx) return
    if (load()) return
    save(attr)
  } catch {
    /* 归因永远不能阻断进站 */
  }
}

export function getAttribution(): Attribution | null {
  return load()
}

/**
 * 短链落地：/t/<code> 用短码到后端换出 c/px/tpx，合并 URL 上平台自动追加的
 * fbclid/ttclid 等参数后走同一套 first-touch 存储，然后把地址栏清回首页。
 * 必须在 initPixels 之前 await——像素 ID 就在换出的快照里。
 */
export async function resolveShortLinkAttribution(): Promise<void> {
  try {
    const m = window.location.pathname.match(/^\/t\/([\w.-]{1,64})$/)
    if (!m) return
    const code = m[1]
    const url = new URL(window.location.href)
    // 先把地址栏清回首页，解析失败也不能让用户停在 /t/ 路径上
    const cleanup = () => {
      try {
        window.history.replaceState(null, '', `/${url.search}`)
      } catch { /* 不阻断 */ }
    }
    // 隐藏重置入口 /t/_reset：清掉本机 first-touch 归因与像素 cookie。
    // 测试机换渠道重测用——正常用户不会碰到，误触也只是丢自己设备的归因，无资损面。
    if (code === '_reset') {
      try { localStorage.removeItem(ATTR_KEY) } catch { /* 忽略 */ }
      for (const k of [ATTR_KEY, '_fbp', '_fbc', '_ttp']) {
        document.cookie = `${k}=; path=/; max-age=0`
      }
      cleanup()
      return
    }
    if (load()) { cleanup(); return } // first-touch 已占位，不覆盖
    const base = window.location.hostname === 'localhost' ? 'http://localhost:3000/api/v1' : `${window.location.origin}/api/v1`
    let resolved: { c?: string; px?: string | null; tpx?: string | null } | null = null
    try {
      const res = await fetch(`${base}/attribution/resolve/${encodeURIComponent(code)}`)
      if (res.ok) {
        const body = (await res.json()) as { code: number; data?: { c?: string; px?: string | null; tpx?: string | null } }
        if (body.code === 0 && body.data) resolved = body.data
      }
    } catch { /* 网络失败走兜底 */ }
    const q = url.searchParams
    const fbclid = trim(q.get('fbclid'), 255)
    const ttclid = trim(q.get('ttclid'), 255)
    const gclid = trim(q.get('gclid'), 255)
    const attr: Attribution = {
      // 后端解析失败时短码本身就是渠道标识——归因（结算的命根）不依赖解析成功
      c: resolved?.c ?? code,
      utm_source: trim(q.get('utm_source'), 128),
      utm_medium: trim(q.get('utm_medium'), 128),
      utm_campaign: trim(q.get('utm_campaign'), 191),
      utm_content: trim(q.get('utm_content'), 191),
      utm_term: trim(q.get('utm_term'), 191),
      plat: fbclid ? 'facebook' : ttclid ? 'tiktok' : gclid ? 'google' : undefined,
      clid: fbclid ?? ttclid ?? gclid,
      lh: url.hostname.slice(0, 191),
      lp: url.pathname.slice(0, 255),
      ref: trim(document.referrer, 255),
      px: resolved?.px ?? undefined,
      tpx: resolved?.tpx ?? undefined,
      ts: Math.floor(Date.now() / 1000),
    }
    save(attr)
    cleanup()
  } catch {
    /* 归因永远不能阻断进站 */
  }
}

/** 采纳服务端配对回来的快照。first-touch 语义不变：本地已有归因则不覆盖 */
export function adoptAttribution(attr: Attribution): void {
  if (load()) return
  save(attr)
}

// _fbp/_fbc/_ttp 由像素脚本自己种，落地瞬间还没有，所以不进 first-touch 快照，
// 每次发请求时现读。fbclid 已知但 _fbc 还没种上时按 FB 规范合成，避免匹配率白丢。
function pixelCookies(attr: Attribution | null): Record<string, string> {
  const out: Record<string, string> = {}
  const fbp = readCookie('_fbp')
  const ttp = readCookie('_ttp')
  let fbc = readCookie('_fbc')
  if (!fbc && attr?.plat === 'facebook' && attr.clid) {
    fbc = `fb.1.${(attr.ts ?? Math.floor(Date.now() / 1000)) * 1000}.${attr.clid}`
  }
  if (fbp) out.fbp = fbp.slice(0, 128)
  if (fbc) out.fbc = fbc.slice(0, 255)
  if (ttp) out.ttp = ttp.slice(0, 128)
  return out
}

function b64(s: string): string {
  let bin = ''
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte)
  return btoa(bin)
}

/** 与 fingerprintHeaders 同款：base64(JSON)，后端 auth 路由在 isNewUser 时落库 */
export function attributionHeaders(): Record<string, string> {
  try {
    const attr = load()
    const cookies = pixelCookies(attr)
    if (!attr && Object.keys(cookies).length === 0) return {}
    return { 'X-Attr': b64(JSON.stringify({ ...(attr ?? {}), ...cookies })) }
  } catch {
    return {}
  }
}
