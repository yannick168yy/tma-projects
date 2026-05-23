interface TelegramWebAppInset {
  top: number
  bottom: number
  left: number
  right: number
}

interface TelegramWebApp {
  ready: () => void
  expand: () => void
  requestFullscreen?: () => void
  exitFullscreen?: () => void
  isFullscreen?: boolean
  isExpanded?: boolean
  safeAreaInset?: TelegramWebAppInset
  contentSafeAreaInset?: TelegramWebAppInset
  onEvent?: (eventType: string, callback: () => void) => void
}

interface Window {
  Telegram?: {
    WebApp: TelegramWebApp
  }
}
