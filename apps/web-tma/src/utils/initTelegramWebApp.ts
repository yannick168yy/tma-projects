/** Telegram Mini App viewport: expand + sync safe-area insets to CSS variables. */
type Inset = { top: number; bottom: number; left: number; right: number }

function readInset(value: Inset | undefined): Inset {
  return {
    top: value?.top ?? 0,
    bottom: value?.bottom ?? 0,
    left: value?.left ?? 0,
    right: value?.right ?? 0,
  }
}

function applySafeAreaInsets(): void {
  const tg = window.Telegram?.WebApp
  if (!tg) return

  const device = readInset(tg.safeAreaInset)
  const content = readInset(tg.contentSafeAreaInset)

  const root = document.documentElement
  root.style.setProperty('--tg-safe-top', `${Math.max(device.top, content.top)}px`)
  root.style.setProperty('--tg-safe-bottom', `${Math.max(device.bottom, content.bottom)}px`)
  root.style.setProperty('--tg-safe-left', `${Math.max(device.left, content.left)}px`)
  root.style.setProperty('--tg-safe-right', `${Math.max(device.right, content.right)}px`)
  root.classList.add('is-telegram-webapp')
}

export function initTelegramWebApp(): void {
  const tg = window.Telegram?.WebApp
  if (!tg) return

  tg.ready()
  tg.expand()
  applySafeAreaInsets()

  tg.onEvent?.('safeAreaChanged', applySafeAreaInsets)
  tg.onEvent?.('contentSafeAreaChanged', applySafeAreaInsets)
  tg.onEvent?.('viewportChanged', applySafeAreaInsets)
}
