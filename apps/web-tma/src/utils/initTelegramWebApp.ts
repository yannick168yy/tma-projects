/** Telegram Mini App viewport: expand, optional fullscreen, safe-area for header. */
type Inset = { top: number; bottom: number; left: number; right: number }

/** Only when TG reports no content inset in fullscreen. */
const TG_HEADER_FALLBACK_PX = 48

function readInset(value: Inset | undefined): Inset {
  return {
    top: value?.top ?? 0,
    bottom: value?.bottom ?? 0,
    left: value?.left ?? 0,
    right: value?.right ?? 0,
  }
}

/** True when opened inside Telegram (not a plain browser with the stub SDK). */
export function isInsideTelegram(): boolean {
  const tg = window.Telegram?.WebApp
  if (!tg) return false
  return Boolean(tg.initData && tg.initData.length > 0)
}

/**
 * Top padding for app header.
 * contentSafeAreaInset is the offset below TG chrome (often already includes notch).
 * Avoid summing device + content — that double-counts and creates a huge gap.
 */
function computeTopInset(tg: TelegramWebApp): number {
  const device = readInset(tg.safeAreaInset)
  const content = readInset(tg.contentSafeAreaInset)

  if (tg.isFullscreen) {
    if (content.top > 0) return Math.max(device.top, content.top)
    return device.top + TG_HEADER_FALLBACK_PX
  }

  // Expanded / compact: only device notch, no extra TG header row in our layout
  return device.top
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
  window.setTimeout(applySafeAreaInsets, 50)
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

  tg.onEvent?.('safeAreaChanged', scheduleInsetUpdates)
  tg.onEvent?.('contentSafeAreaChanged', scheduleInsetUpdates)
  tg.onEvent?.('viewportChanged', scheduleInsetUpdates)
  tg.onEvent?.('fullscreenChanged', () => {
    requestFullscreenIfNeeded(tg)
    scheduleInsetUpdates()
  })
}
