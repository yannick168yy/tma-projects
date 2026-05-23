import { isInsideTelegram } from '@/utils/initTelegramWebApp'

let lockCount = 0

/** Disable TG pull-down-to-close while bottom sheets are open (Bot API 7.7+). */
export function setTelegramBottomSheetSwipeLock(locked: boolean): void {
  if (!isInsideTelegram()) return
  const tg = window.Telegram?.WebApp
  if (!tg) return

  lockCount += locked ? 1 : -1
  if (lockCount < 0) lockCount = 0

  try {
    if (lockCount > 0) {
      tg.disableVerticalSwipes?.()
    } else {
      tg.enableVerticalSwipes?.()
    }
  } catch {
    // Older clients ignore swipe APIs
  }
}
