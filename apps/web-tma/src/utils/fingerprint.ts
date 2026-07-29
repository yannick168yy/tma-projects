// 设备指纹采集：给风控提供多开/薅羊毛识别信号
// 三个标识，稳定性从高到低：
//   deviceId  —— 前端下发的随机 ID，localStorage+cookie 双写，最稳（除非清缓存/换浏览器）
//   fpVisitor —— FingerprintJS 硬件指纹 hash，deviceId 丢失时兜底，概率稳定（升级/隐私插件会漂）
//   signals   —— 原始信号，后端做相似度匹配用（hash 漂了但 GPU+屏幕+时区一致仍可判同设备）
// 三者都与 IP 无关：用户换 WiFi/4G/代理，这三个值都不变。
import FingerprintJS from '@fingerprintjs/fingerprintjs'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { clientPlatform } from '@/utils/pwa'

// Android 壳原生插件：返回 ANDROID_ID（重装不变），补 FingerprintJS 在 WebView 里出不了值的盲区
const HardwareId = registerPlugin<{ getId(): Promise<{ id: string }> }>('HardwareId')

// 仅在原生 App 里取硬件 ID，作为 fpVisitor；带前缀便于后台区分且不与 FingerprintJS hash 撞值。
// web/PWA 返回空串，走原有 FingerprintJS 路径。
async function nativeHardwareFp(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return ''
  try {
    const { id } = await HardwareId.getId()
    return id ? `aid_${id}` : ''
  } catch {
    return ''
  }
}

const DEVICE_ID_KEY = 'betogo_device_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2 // 2 年

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
}

function randomId(): string {
  if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '')
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

// deviceId 同步可用：localStorage 与 cookie 互为兜底，任一存活即恢复
function getDeviceId(): string {
  let id = ''
  try {
    id = localStorage.getItem(DEVICE_ID_KEY) || readCookie(DEVICE_ID_KEY) || ''
  } catch {
    id = readCookie(DEVICE_ID_KEY) || ''
  }
  if (!id) id = randomId()
  try {
    localStorage.setItem(DEVICE_ID_KEY, id)
  } catch {
    /* 隐私模式下 localStorage 可能抛错，靠 cookie 兜底 */
  }
  writeCookie(DEVICE_ID_KEY, id)
  return id
}

function collectSignals(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number }
  let gpu = ''
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
  } catch {
    /* 部分环境禁用 webgl */
  }
  return {
    gpu,
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    dpr: window.devicePixelRatio,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency,
    memory: nav.deviceMemory,
    touch: navigator.maxTouchPoints,
    webdriver: navigator.webdriver === true, // 识别自动化脚本/机器人
  }
}

let cache: { deviceId: string; fpVisitor: string; signals: string } | null = null
let initPromise: Promise<void> | null = null

// UTF-8 安全的 base64，供 header 传输（header 只能 ASCII）
function b64(obj: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
}

// 应用启动时调用一次；FingerprintJS 初始化较慢（几十~几百 ms），提前预热
export async function initFingerprint(): Promise<void> {
  if (cache) return
  if (initPromise) return initPromise
  initPromise = (async () => {
    const deviceId = getDeviceId()
    // App 优先用 ANDROID_ID（重装不变）；web/PWA 或取不到时回落 FingerprintJS
    let fpVisitor = await nativeHardwareFp()
    if (!fpVisitor) {
      try {
        const fp = await FingerprintJS.load()
        const r = await fp.get()
        fpVisitor = r.visitorId
      } catch {
        /* 指纹失败不影响登录，deviceId 仍可用 */
      }
    }
    cache = { deviceId, fpVisitor, signals: b64(collectSignals()) }
  })()
  return initPromise
}

// 同步返回当前可用的指纹 header。deviceId 永远可用；
// fpVisitor/signals 在 initFingerprint 完成前可能为空，属可接受的降级。
export function fingerprintHeaders(): Record<string, string> {
  const deviceId = cache?.deviceId ?? getDeviceId()
  const headers: Record<string, string> = { 'X-Device-Id': deviceId, 'X-Platform': clientPlatform() }
  if (cache?.fpVisitor) headers['X-Fp-Visitor'] = cache.fpVisitor
  if (cache?.signals) headers['X-Fp-Signals'] = cache.signals
  return headers
}
