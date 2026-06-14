export const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? 'BetoGoBot'
// Telegram 新版网页登录（OIDC）的 client_id，即 bot_id
export const TELEGRAM_OIDC_CLIENT_ID = import.meta.env.VITE_TELEGRAM_OIDC_CLIENT_ID ?? '8736530159'
export const TELEGRAM_WEB_APP_URL =
  import.meta.env.VITE_TELEGRAM_WEB_APP_URL ?? 'https://www.188facai.com'

export function buildInviteDeepLink(inviteCode: string): string {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${inviteCode}`
}

export function buildInviteWebLink(inviteCode: string): string {
  const base = TELEGRAM_WEB_APP_URL.replace(/\/$/, '')
  return `${base}?ref=${encodeURIComponent(inviteCode)}`
}
