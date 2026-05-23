/** Telegram Mini App viewport: expand, fullscreen, safe-area for header. */
type Inset = { top: number; bottom: number; left: number; right: number }

/** Fullscreen TG chrome fallback when content inset not reported yet. */
const TG_HEADER_FALLBACK_PX = 52

function readInset(value: Inset | undefined): Inset {
  return {
    top: value?.top ?? 0,
    bottom: value?.bottom ?? 0,
    left: value?.left ?? 0,
    right: value?.right ?? 0,
  }
}

function readCssInsetPx(varName: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return 0
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

/** True when opened inside Telegram (not a plain browser with the stub SDK). */
export function isInsideTelegram(): boolean {
  const tg = window.Telegram?.WebApp
  if (!tg) return false
  return Boolean(tg.initData && tg.initData.length > 0)
}

/**
 * TMA top inset — differs from mobile browser (env only).
 * Fullscreen: device notch + TG header row (sum when both reported).
 */
function computeTopInset(tg: TelegramWebApp): number {
  const device = readInset(tg.safeAreaInset)
  const content = readInset(tg.contentSafeAreaInset)

  const d = Math.max(device.top, readCssInsetPx('--tg-safe-area-inset-top'))
  const c = Math.max(content.top, readCssInsetPx('--tg-content-safe-area-inset-top'))

  if (tg.isFullscreen) {
    if (d > 0 && c > 0) return d + c
    if (c > 0) return c
    return d + TG_HEADER_FALLBACK_PX
  }

  if (c > 0) return Math.max(d, c)
  return d
}

function computeInsets(tg: TelegramWebApp): Inset {
  const device = readInset(tg.safeAreaInset)
  const content = readInset(tg.contentSafeAreaInset)

  return {
    top: computeTopInset(tg),
    bottom: Math.max(device.bottom, content.bottom),
    left: Math.max(device.left, content.left),
    right: Math.max(device.right, content.right),
  }
}

function applySafeAreaInsets(): void {
  const tg = window.Telegram?.WebApp
  if (!tg || !isInsideTelegram()) return

  const total = computeInsets(tg)
  const root = document.documentElement
  root.style.setProperty('--tg-safe-top', `${total.top}px`)
  root.style.setProperty('--tg-safe-bottom', `${total.bottom}px`)
  root.style.setProperty('--tg-safe-left', `${total.left}px`)
  root.style.setProperty('--tg-safe-right', `${total.right}px`)
  root.classList.add('is-telegram-webapp')
}

function clearTelegramSafeArea(): void {
  const root = document.documentElement
  root.style.removeProperty('--tg-safe-top')
  root.style.removeProperty('--tg-safe-bottom')
  root.style.removeProperty('--tg-safe-left')
  root.style.removeProperty('--tg-safe-right')
  root.classList.remove('is-telegram-webapp')
}

function scheduleInsetUpdates(): void {
  applySafeAreaInsets()
  requestAnimationFrame(applySafeAreaInsets)
  for (const ms of [50, 150, 300, 600, 1000]) {
    window.setTimeout(applySafeAreaInsets, ms)
  }
}

function requestFullscreenIfNeeded(tg: TelegramWebApp): void {
  if (!isInsideTelegram() || tg.isFullscreen || !tg.requestFullscreen) return
  try {
    tg.requestFullscreen()
  } catch {
    // Bot API 8.0+ only
  }
}

export function initTelegramWebApp(): void {
  const tg = window.Telegram?.WebApp
  if (!tg) return

  if (!isInsideTelegram()) {
    clearTelegramSafeArea()
    return
  }

  tg.ready()
  tg.expand()
  requestFullscreenIfNeeded(tg)
  scheduleInsetUpdates()

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleInsetUpdates)
  }

  tg.onEvent?.('safeAreaChanged', scheduleInsetUpdates)
  tg.onEvent?.('contentSafeAreaChanged', scheduleInsetUpdates)
  tg.onEvent?.('viewportChanged', scheduleInsetUpdates)
  tg.onEvent?.('fullscreenChanged', () => {
    requestFullscreenIfNeeded(tg)
    scheduleInsetUpdates()
  })
}
