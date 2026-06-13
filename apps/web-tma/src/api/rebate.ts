import { apiRequest } from '@/api/client'

export interface RebateConfigItem {
  gameCategory: string
  ratePct: number
  enabled: boolean
}

export interface FeaturedGame {
  gameUuid: string
  tier: string
  sortOrder: number
  name?: string
  nameZh?: string
  provider?: string
  coverUrl?: string
}

export interface RebateConfig {
  config: RebateConfigItem[]
  featured: Record<string, FeaturedGame[]>
}

export interface RebateSummaryItem {
  gameCategory: string
  betAmount: number
  rebateAmount: number
  ratePct: number
}

export interface RebateSummary {
  date: string
  status: 'estimated' | 'paid' | 'processing'
  totalBet: number
  totalRebate: number
  currency: string
  breakdown: RebateSummaryItem[]
}

export async function fetchRebateConfig(): Promise<RebateConfig> {
  return apiRequest<RebateConfig>('/rebate/config')
}

export async function fetchRebateSummary(date: 'today' | 'yesterday', currency?: string): Promise<RebateSummary> {
  const params = new URLSearchParams({ date })
  if (currency) params.set('currency', currency)
  return apiRequest<RebateSummary>(`/rebate/summary?${params}`)
}
