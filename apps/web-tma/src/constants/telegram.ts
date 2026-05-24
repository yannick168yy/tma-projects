export const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? 'BetoGoBot'
export const TELEGRAM_WEB_APP_URL =
  import.meta.env.VITE_TELEGRAM_WEB_APP_URL ?? 'https://www.188facai.com'

export function buildInviteDeepLink(inviteCode: string): string {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${inviteCode}`
}
