interface TelegramWebAppInset {
  top: number
  bottom: number
  left: number
  right: number
}

interface TelegramWebAppUser {
  id: number
  username?: string
  first_name?: string
  last_name?: string
  photo_url?: string
}

interface TelegramBackButton {
  isVisible: boolean
  show: () => void
  hide: () => void
  onClick: (callback: () => void) => void
  offClick: (callback: () => void) => void
}

interface TelegramWebApp {
  ready: () => void
  expand: () => void
  initData?: string
  initDataUnsafe?: {
    user?: TelegramWebAppUser
    start_param?: string
  }
  requestFullscreen?: () => void
  exitFullscreen?: () => void
  isFullscreen?: boolean
  isExpanded?: boolean
  safeAreaInset?: TelegramWebAppInset
  contentSafeAreaInset?: TelegramWebAppInset
  onEvent?: (eventType: string, callback: () => void) => void
  disableVerticalSwipes?: () => void
  enableVerticalSwipes?: () => void
  isVerticalSwipesEnabled?: boolean
  openLink?: (url: string) => void
  openInvoice?: (url: string, callback?: (status: string) => void) => void
  BackButton?: TelegramBackButton
}

interface Window {
  Telegram?: {
    WebApp: TelegramWebApp
  }
}
