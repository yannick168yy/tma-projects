export const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? 'BetoGoBot'
// Telegram 新版网页登录（OIDC）的 client_id，即 bot_id
export const TELEGRAM_OIDC_CLIENT_ID = import.meta.env.VITE_TELEGRAM_OIDC_CLIENT_ID ?? '8736530159'

const DOMAIN_TELEGRAM_OIDC_CLIENT_IDS: Record<string, string> = {
  // 测试环境专用 bot @betogotestbot（BotFather /setdomain 已绑 www.188facai.com）
  'www.188facai.com': '8820696982',
  'betogo.xyz': '8583165610',
  'betogo.ph': '8650093054',
  'betogo888.com': '8612790363',
  'betogo666.com': '8028064412',
  'betogo777.com': '8528050220',
  'betogo.app': '8512572445',
  'betogo.cc': '8688814745',
  'betogo.vip': '8739647304',
}
const DISABLED_TELEGRAM_OIDC_HOSTS = new Set<string>()

export function getTelegramOidcClientId(): string {
  if (typeof window === 'undefined') return TELEGRAM_OIDC_CLIENT_ID
  return DOMAIN_TELEGRAM_OIDC_CLIENT_IDS[window.location.hostname.toLowerCase()] ?? TELEGRAM_OIDC_CLIENT_ID
}

export function isTelegramOidcLoginAvailable(): boolean {
  if (typeof window === 'undefined') return true
  return !DISABLED_TELEGRAM_OIDC_HOSTS.has(window.location.hostname.toLowerCase())
}

export function buildInviteDeepLink(inviteCode: string): string {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${inviteCode}`
}

export function buildInviteWebLink(inviteCode: string): string {
  // 一份 bundle 部署多域名,分享链必须随当前域名走;不能用构建时烤死的测试域名,
  // 否则生产用户复制的邀请链会指向测试站 188facai。
  return `${window.location.origin}?ref=${encodeURIComponent(inviteCode)}`
}
