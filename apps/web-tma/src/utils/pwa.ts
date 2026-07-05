import { isInsideTelegram } from '@/utils/initTelegramWebApp'

/** Chromium beforeinstallprompt（TS 无内置类型） */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

/** 必须在 app 启动时尽早调用：注册 SW + 捕获 beforeinstallprompt */
export function initPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export function onPwaStateChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 已从主屏幕启动（PWA 模式运行中） */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
}

/** Android/桌面 Chromium 已捕获原生安装事件，可一键弹安装 */
export function canNativeInstall(): boolean {
  return deferredPrompt !== null
}

export async function promptNativeInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable'
  const evt = deferredPrompt
  deferredPrompt = null
  notify()
  await evt.prompt()
  const choice = await evt.userChoice
  return choice.outcome
}

/** 当前环境是否值得展示安装引导（浏览器访问、未安装、非 TG 内） */
export function shouldOfferInstall(): boolean {
  if (isInsideTelegram()) return false
  if (isStandalone()) return false
  return canNativeInstall() || isIos()
}

const SNOOZE_KEY = 'betogo_pwa_prompt_snooze'
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000

export function isInstallPromptSnoozed(): boolean {
  const raw = localStorage.getItem(SNOOZE_KEY)
  if (!raw) return false
  const until = Number(raw)
  return Number.isFinite(until) && Date.now() < until
}

export function snoozeInstallPrompt() {
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
}
