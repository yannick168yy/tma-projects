export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  traceId?: string
}

export type LoginProvider = 'telegram' | 'google'

export interface AuthUser {
  id: string
  telegramUserId?: number
  telegramUsername?: string
  displayName: string
  avatarUrl?: string
  inviteCode?: string
  loginProvider?: LoginProvider
  email?: string
  isNewUser?: boolean
  profile?: UserProfile
}

export interface AuthSession {
  token: string
  expiresIn: number
  user: AuthUser
  isNewUser: boolean
  trialRedPacketEligible?: boolean
}

export interface WalletBalance {
  currency: 'PHP'
  availableCents: number
  frozenCents: number
  displayPhp: string
}

export interface UserProfile {
  firstName: string
  lastName: string
  gender: '' | 'male' | 'female' | 'other'
  dobMonth: string
  dobDay: string
  dobYear: string
}

export type PromoId = 'trial' | 'referral' | 'firstdep'

export interface PromoHighlight {
  promoId: PromoId
  highlight: boolean
  flagLabel: string | null
}

export interface ReferralRecord {
  id: string
  role: 'inviter' | 'invitee'
  displayName: string
  status: 'pending' | 'qualified' | 'claimed'
  rewardPhp: number
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
}
