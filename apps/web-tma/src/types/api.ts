export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  traceId?: string
}

export type LoginProvider = 'telegram' | 'google' | 'phone'
export type PasswordMethod = 'phone'

export interface AuthUser {
  id: string
  telegramUserId?: number
  telegramUsername?: string
  displayName: string
  avatarUrl?: string
  inviteCode?: string
  loginProvider?: LoginProvider
  email?: string
  phone?: string
  isNewUser?: boolean
  boundTelegram?: boolean
  boundGoogle?: boolean
  boundPhone?: boolean
  isAgent?: boolean
  firstDepClaimed?: boolean
  locale?: string
}

export interface TelegramWidgetUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export interface AuthSession {
  token: string
  expiresIn: number
  user: AuthUser
  isNewUser: boolean
  trialRedPacketEligible?: boolean
}

export interface CurrencyBalance {
  currency: string
  available: number
  frozen: number
}

export interface WalletBalance {
  currency: 'PHP'
  availableCents: number
  frozenCents: number
  displayPhp: string
  balances: CurrencyBalance[]
}

export type PromoId = 'trial' | 'firstdep'

export interface PromoHighlight {
  promoId: PromoId
  highlight: boolean
  flagLabel: string | null
}

export interface RedPacketRecord {
  id: string
  type: string
  amountPhp: number
  createdAt: string
}

export interface TeamAgentStatus {
  isAgent: boolean
  activated: boolean
  l1Count: number
  l2Count: number
  l3Count: number
  availableCents: number
  lifetimeEarnedCents: number
  currency: 'PHP' | 'IDR'
  ratePlan: { l1RatePct: number; l2RatePct: number; l3RatePct: number }
}
