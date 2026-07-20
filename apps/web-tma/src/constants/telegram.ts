export const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? 'BetoGoBot'
// Telegram 新版网页登录（OIDC）的 client_id，即 bot_id
export const TELEGRAM_OIDC_CLIENT_ID = import.meta.env.VITE_TELEGRAM_OIDC_CLIENT_ID ?? '8736530159'

export function buildInviteDeepLink(inviteCode: string): string {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${inviteCode}`
}

export function buildInviteWebLink(inviteCode: string): string {
  // 一份 bundle 部署多域名,分享链必须随当前域名走;不能用构建时烤死的测试域名,
  // 否则生产用户复制的邀请链会指向测试站 188facai。
  return `${window.location.origin}?ref=${encodeURIComponent(inviteCode)}`
}
