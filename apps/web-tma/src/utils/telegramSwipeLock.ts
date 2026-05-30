import { isInsideTelegram } from '@/utils/initTelegramWebApp'

/** Disable TG pull-down-to-close while bottom sheets are open (Bot API 7.7+).
 *  注意：竖向滑动在 initTelegramWebApp 中已全局禁用，此处仅做加固，不再重新开启。
 */
export function setTelegramBottomSheetSwipeLock(locked: boolean): void {
  if (!isInsideTelegram() || !locked) return
  try {
    window.Telegram?.WebApp?.disableVerticalSwipes?.()
  } catch {
    // Older clients ignore swipe APIs
  }
}
