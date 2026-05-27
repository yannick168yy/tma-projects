import type { AppLocale } from './locale.js'

export type UserStatus = 'active' | 'frozen' | 'banned'
export type KycStatus = 'none' | 'pending' | 'approved' | 'rejected'
export type DepositCurrency = 'PHP' | 'USDT' | 'TON'

export interface UserProfile {
  firstName: string
  lastName: string
  gender: '' | 'male' | 'female' | 'other'
  dobMonth: string
  dobDay: string
  dobYear: string
  phone?: string
  email?: string
}

export interface UserRecord {
  id: string
  telegramUserId?: number
  /** Telegram @username without @ */
  telegramUsername?: string
  googleSub?: string
  email?: string
  displayName: string
  avatarUrl?: string
  inviteCode: string
  referredBy?: string
  locale: AppLocale
  /** 被邀请人首充达标（≥₱100）已触发，避免重复处理 */
  referralMilestoneMet?: boolean
  status: UserStatus
  statusReason?: string
  label?: string
  lastLoginAt?: string
  lastLoginIp?: string
  lastLoginRegion?: string
  registerIp?: string
  registerRegion?: string
  registeredAt: string
  profile: UserProfile
  trialClaimed: boolean
  referralClaimed: boolean
  firstDepClaimed: boolean
  referralReady: boolean
  firstDepReady: boolean
}

export interface SessionRecord {
  userId: string
  expiresAt: string
}

export interface WalletRecord {
  available: number
  frozen: number
}

export interface TurnoverRecord {
  multiplier: number
  required: number
  completed: number
  canWithdraw: boolean
}

export interface TonConnectParams {
  userWalletAddress: string
  amountNano: string
  merchantAddress: string
  expiresAt: string
  txHash?: string
}

export interface OrderDeposit {
  orderId: string
  userId: string
  amount: number
  currency: DepositCurrency
  channelId: string
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'rejected'
  createdAt: string
  paidAt?: string
  creditedCents?: number
  provider?: string
  providerRef?: string
  extraData?: Record<string, unknown>
  tgWalletParams?: Record<string, string>
  tonConnectParams?: TonConnectParams
}

export interface OrderWithdraw {
  orderId: string
  userId: string
  amount: number
  currency: 'PHP'
  channelId: string
  status: 'pending' | 'processing' | 'completed' | 'rejected' | 'failed'
  createdAt: string
  completedAt?: string
  rejectReason?: string
  provider?: string
  providerRef?: string
  extraData?: Record<string, unknown>
}

/** @deprecated use OrderDeposit */
export type DepositOrder = OrderDeposit
/** @deprecated use OrderWithdraw */
export type WithdrawOrder = OrderWithdraw

export interface LedgerEntry {
  id: string
  userId: string
  type: 'deposit' | 'withdraw' | 'bet' | 'red_packet' | 'bonus' | 'admin_adjust'
  amount: number
  balanceAfter: number
  refId?: string
  description: string
  createdAt: string
  traceId?: string
}

export interface KycSubmission {
  submissionId: string
  userId: string
  status: KycStatus
  fullName: string
  gender: string
  dob: string
  docType?: string
  fileIds?: string[]
  rejectReason?: string
  submittedAt: string
}

export interface PromotionItem {
  promoId: string
  title: string
  subtitle: string
  description: string
  ctaLabel: string
  highlight: boolean
  flagLabel: string | null
}
