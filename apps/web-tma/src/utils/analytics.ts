import type { AuthUser, LoginProvider, PromoId } from '@/types/api'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim()

export type ClientPlatform = 'web' | 'android_app' | 'telegram_tma'

export function getClientPlatform(): ClientPlatform {
  if (window.Telegram?.WebApp?.initData) return 'telegram_tma'
  if (/Android/i.test(navigator.userAgent)) return 'android_app'
  return 'web'
}

function baseParams() {
  return {
    platform: getClientPlatform(),
    app_surface: 'web_primary_android_tma',
  }
}

export function initAnalytics() {
  if (!GA_ID || window.gtag) return
  window.dataLayer = window.dataLayer || []
  window.gtag = (...args: unknown[]) => window.dataLayer?.push(args)

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`
  document.head.appendChild(script)

  window.gtag('js', new Date())
  window.gtag('config', GA_ID, {
    send_page_view: false,
    ...baseParams(),
  })
}

export function trackPageView(path: string, title = document.title) {
  if (!GA_ID || !window.gtag) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: title,
    ...baseParams(),
  })
}

export function setAnalyticsUser(user: AuthUser | null) {
  if (!GA_ID || !window.gtag) return
  window.gtag('set', {
    user_id: user?.id ?? null,
    user_properties: user
      ? {
          login_provider: user.loginProvider ?? 'unknown',
          is_agent: Boolean(user.isAgent),
          platform: getClientPlatform(),
        }
      : null,
  })
}

function track(eventName: string, params: Record<string, unknown> = {}) {
  if (!GA_ID || !window.gtag) return
  window.gtag('event', eventName, {
    ...params,
    ...baseParams(),
  })
}

export const analytics = {
  loginStart(provider: LoginProvider | 'telegram_oidc') {
    track('login_start', { method: provider })
  },
  loginSuccess(provider: LoginProvider | 'telegram_oidc' | 'unknown', isNewUser: boolean) {
    track('login_success', { method: provider, is_new_user: isNewUser })
    if (isNewUser) track('sign_up_success', { method: provider })
  },
  depositStart(method: string | undefined, amount: number, currency: string) {
    track('deposit_start', { payment_method: method ?? 'unknown', value: amount, currency })
  },
  depositOrderCreated(method: string | undefined, amount: number, currency: string, orderId?: string) {
    track('deposit_order_created', { payment_method: method ?? 'unknown', value: amount, currency, order_id: orderId })
  },
  depositSuccess(method: string | undefined, amount: number, currency: string, orderId?: string) {
    track('deposit_success', { payment_method: method ?? 'unknown', value: amount, currency, order_id: orderId })
  },
  withdrawStart(method: string | undefined, amount: number, currency: string) {
    track('withdraw_start', { payment_method: method ?? 'unknown', value: amount, currency })
  },
  withdrawCreated(method: string | undefined, amount: number, currency: string) {
    track('withdraw_created', { payment_method: method ?? 'unknown', value: amount, currency })
  },
  gameLaunch(kind: 'real' | 'demo', gameUuid: string, currency: string, source: string) {
    track('game_launch_success', { game_mode: kind, game_uuid: gameUuid, currency, source })
  },
  shareInvite(platform: string) {
    track('share_invite', { share_platform: platform })
  },
  agentActivated() {
    track('circle_rewards_activated')
  },
  promoClaimSuccess(id: PromoId, amountPhp: number) {
    track('promo_claim_success', { promo_id: id, value: amountPhp, currency: 'PHP' })
  },
  rebateClaimSuccess(amount: number, currency: string) {
    track('promo_claim_success', { promo_id: 'cashback', value: amount, currency })
  },
  spinPrizeSuccess(amountPhp: number, prizeId: number, recordId: string) {
    track('promo_claim_success', { promo_id: 'rewards_spin', value: amountPhp, currency: 'PHP', prize_id: prizeId, record_id: recordId })
  },
}
