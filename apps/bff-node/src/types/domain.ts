import type { AppLocale } from './locale.js'

export type UserStatus = 'active' | 'frozen' | 'banned'
export type KycStatus = 'none' | 'pending' | 'approved' | 'rejected'
export type KycRejectStep = 'phone' | 'document' | 'face'
export type LivenessAction = 'neutral' | 'blink' | 'mouth'

export interface LivenessFrameMeta {
  action: LivenessAction
  key: string
  capturedAt: string
}
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
  /** Telegram 网页登录(OIDC) 的 sub：按 bot 派生的匿名 id，与 telegramUserId 不同 */
  telegramOidcSub?: string
  googleSub?: string
  /** 账号登录用户名 */
  username?: string
  /** scrypt 密码哈希，账号/手机模式共用 */
  passwordHash?: string
  /** 手机号登录凭证(E.164)，未验证，与 KYC 已验手机分离 */
  phoneAccount?: string
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

export interface WalletBalance {
  currency: string
  available: number
  frozen: number
}

/** @deprecated 仅用于 PHP 单币种场景 */
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
  currency: string
  channelId: string
  status: 'pending' | 'processing' | 'completed' | 'rejected' | 'admin_rejected' | 'failed'
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
  currency?: string  // 默认 'PHP'
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
  /** KYC 已验证手机(E.164)，与登录用 phoneAccount 分离 */
  phone?: string
  phoneVerified?: boolean
  verifyMode?: 'document' | 'face'
  /** Gemini 从证件提取的证件号，用于防重 */
  extractedIdNo?: string
  geminiConfidence?: number
  geminiResult?: Record<string, unknown>
  docImageKey?: string
  selfieImageKey?: string
  docVerified?: boolean
  faceVerified?: boolean
  rejectStep?: KycRejectStep
  livenessFrames?: LivenessFrameMeta[]
  docSubmittedAt?: string
  faceSubmittedAt?: string
  reviewedAt?: string
  /** 人工复核管理员用户名；自动放行为空 */
  reviewedBy?: string
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
