import { apiRequest } from '@/api/client'

export interface VipBenefit {
  level: number
  promotionBonus: number
  weeklySalary: number
  monthlySalary: number
  birthdayBonus: number
  negativeRebatePct: number
  retentionLine: number
  withdrawDailyLimit: number
  withdrawDailyCount: number
}

export interface VipClaimableByType {
  type: string
  amount: number
}

export interface VipProgress {
  currency: string
  totalTurnover: number
  level: number
  currentThreshold: number
  nextLevel: number | null
  nextThreshold: number | null
  benefit: VipBenefit | null
  nextBenefit: VipBenefit | null
  claimable: number
  claimableByType: VipClaimableByType[]
  awardedLevel: number
  demoted: boolean
  quarterTurnover: number
  retentionLine: number
  prioritySupport: boolean
  birthdaySet: boolean
}

export interface VipLevelConfig extends VipBenefit {
  minTurnover: number
}

export interface VipReward {
  id: number
  level: number
  type: string
  amount: number
  currencyCode: string
  periodKey: string
  status: string
  createdAt: string | null
  paidAt: string | null
}

export async function fetchVipProgress(currency?: string): Promise<VipProgress> {
  const params = new URLSearchParams()
  if (currency) params.set('currency', currency)
  const qs = params.toString()
  return apiRequest<VipProgress>(`/vip/progress${qs ? `?${qs}` : ''}`)
}

export async function fetchVipLevels(currency?: string): Promise<{ levels: VipLevelConfig[] }> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : ''
  return apiRequest<{ levels: VipLevelConfig[] }>(`/vip/levels${qs}`)
}

export async function fetchVipRewards(currency?: string): Promise<{ rewards: VipReward[] }> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : ''
  return apiRequest<{ rewards: VipReward[] }>(`/vip/rewards${qs}`)
}

export async function claimVipRewards(currency?: string): Promise<{ claimed: number; totalAmount: number }> {
  return apiRequest<{ claimed: number; totalAmount: number }>('/vip/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currency }),
  })
}

export interface LossRebateStatus {
  enabled: boolean
  currency: string
  ratePct: number
  minDeposit: number
  windowDays: number
  netLoss: number
  windowDeposit: number
  potentialRebate: number
  eligible: boolean
  reason: 'disabled' | 'no_loss' | 'need_deposit' | 'eligible' | 'pending'
  pendingClaimable: number
  /** 今日 period 已结算（含已领+待领） */
  todaySettled: number
  /** 今日 period 已领取金额 */
  todayClaimed: number
}

/** 负盈利返水「今日至今」实时状态：净输 / 预计可返 / 是否达标 / 不可领原因 */
export async function fetchLossRebateStatus(currency?: string): Promise<LossRebateStatus> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : ''
  return apiRequest<LossRebateStatus>(`/vip/loss-rebate-status${qs}`)
}

// 生日不再支持手输：KYC 通过后由后端从证件信息自动同步
