/** Telegram Mini App viewport: expand + sync safe-area insets (device + TG chrome). */
type Inset = { top: number; bottom: number; left: number; right: number }

/** TG fullscreen header row (close / collapse / menu) when API reports 0. */
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

/**
 * Per Telegram docs / community: total offset = safeAreaInset + contentSafeAreaInset
 * (not max). contentSafeAreaInset clears TG close / menu buttons in fullscreen.
 */
function computeInsets(tg: TelegramWebApp): Inset {
  const device = readInset(tg.safeAreaInset)
  let content = readInset(tg.contentSafeAreaInset)

  // SDK also exposes CSS vars; use whichever is larger per edge
  content = {
    top: Math.max(content.top, readCssInsetPx('--tg-content-safe-area-inset-top')),
    bottom: Math.max(content.bottom, readCssInsetPx('--tg-content-safe-area-inset-bottom')),
    left: Math.max(content.left, readCssInsetPx('--tg-content-safe-area-inset-left')),
    right: Math.max(content.right, readCssInsetPx('--tg-content-safe-area-inset-right')),
  }

  const deviceFromCss = {
    top: readCssInsetPx('--tg-safe-area-inset-top'),
    bottom: readCssInsetPx('--tg-safe-area-inset-bottom'),
    left: readCssInsetPx('--tg-safe-area-inset-left'),
    right: readCssInsetPx('--tg-safe-area-inset-right'),
  }

  const d = {
    top: Math.max(device.top, deviceFromCss.top),
    bottom: Math.max(device.bottom, deviceFromCss.bottom),
    left: Math.max(device.left, deviceFromCss.left),
    right: Math.max(device.right, deviceFromCss.right),
  }

  let contentTop = content.top
  if (contentTop === 0 && (tg.isFullscreen || tg.isExpanded !== false)) {
    contentTop = TG_HEADER_FALLBACK_PX
  }

  return {
    top: d.top + contentTop,
    bottom: d.bottom + content.bottom,
    left: d.left + content.left,
    right: d.right + content.right,
  }
}

function applySafeAreaInsets(): void {
  const tg = window.Telegram?.WebApp
  if (!tg) return

  const total = computeInsets(tg)
  const root = document.documentElement
  root.style.setProperty('--tg-safe-top', `${total.top}px`)
  root.style.setProperty('--tg-safe-bottom', `${total.bottom}px`)
  root.style.setProperty('--tg-safe-left', `${total.left}px`)
  root.style.setProperty('--tg-safe-right', `${total.right}px`)
  root.classList.add('is-telegram-webapp')
}

function scheduleInsetUpdates(): void {
  applySafeAreaInsets()
  requestAnimationFrame(applySafeAreaInsets)
  window.setTimeout(applySafeAreaInsets, 50)
  window.setTimeout(applySafeAreaInsets, 300)
}

/** BotFather Main App fullscreen does not apply to menu-button launches; request in code. */
function requestFullscreenIfNeeded(tg: TelegramWebApp): void {
  if (tg.isFullscreen || !tg.requestFullscreen) return
  try {
    tg.requestFullscreen()
  } catch {
    // Older clients may not support Bot API 8.0+ fullscreen
  }
}

export function initTelegramWebApp(): void {
  const tg = window.Telegram?.WebApp
  if (!tg) return

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
