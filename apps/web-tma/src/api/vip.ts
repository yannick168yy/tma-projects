import { apiRequest } from '@/api/client'

export interface VipBenefit {
  level: number
  promotionBonus: number
  weeklySalary: number
  monthlySalary: number
  negativeRebatePct: number
  retentionLine: number
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

export async function fetchVipRewards(): Promise<{ rewards: VipReward[] }> {
  return apiRequest<{ rewards: VipReward[] }>('/vip/rewards')
}

export async function claimVipRewards(currency?: string): Promise<{ claimed: number; totalAmount: number }> {
  return apiRequest<{ claimed: number; totalAmount: number }>('/vip/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currency }),
  })
}
