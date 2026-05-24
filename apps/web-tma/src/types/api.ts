export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  traceId?: string
}

export interface AuthUser {
  id: string
  telegramUserId?: number
  displayName: string
  avatarUrl?: string
  inviteCode?: string
  isNewUser?: boolean
}

export interface AuthSession {
  token: string
  expiresIn: number
  user: AuthUser
  isNewUser: boolean
  trialRedPacketEligible?: boolean
}

export type UserStatus = 'active' | 'frozen' | 'banned'

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
