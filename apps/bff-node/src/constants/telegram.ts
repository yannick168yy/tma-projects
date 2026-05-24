export const TELEGRAM_BOT_USERNAME = 'BetoGoBot'
export const TELEGRAM_MINI_APP_SHORT_NAME = 'BetoGo'
export const TELEGRAM_WEB_APP_URL = 'https://www.188facai.com'

export function buildInviteDeepLink(inviteCode: string): string {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${inviteCode}`
}
