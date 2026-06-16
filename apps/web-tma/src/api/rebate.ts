import { apiRequest } from '@/api/client'

export interface RebateConfigItem {
  gameCategory: string
  ratePct: number
  maxBonus: number
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

export interface RebateLevelRates {
  level: number
  minTurnover: number
  rates: RebateConfigItem[]
}

export interface RebateConfig {
  config: RebateConfigItem[]
  levels: RebateLevelRates[]
  featured: Record<string, FeaturedGame[]>
}

export interface RebateSummaryItem {
  gameCategory: string
  betAmount: number
  rebateAmount: number
  ratePct: number
}

export interface RebateTierSummaryItem {
  tier: string
  betAmount: number
  rebateAmount: number
}

export interface RebateSummary {
  date: string
  status: 'estimated' | 'paid' | 'processing'
  totalBet: number
  totalRebate: number
  currency: string
  breakdown: RebateSummaryItem[]
  tierBreakdown: RebateTierSummaryItem[]
}

export interface RebateProgress {
  currency: string
  totalTurnover: number
  level: number
  currentThreshold: number
  nextLevel: number | null
  nextThreshold: number | null
  rates: RebateConfigItem[]
  claimable: number
}

export async function fetchRebateConfig(): Promise<RebateConfig> {
  return apiRequest<RebateConfig>('/rebate/config')
}

export async function fetchRebateProgress(currency?: string): Promise<RebateProgress> {
  const params = new URLSearchParams()
  if (currency) params.set('currency', currency)
  const qs = params.toString()
  return apiRequest<RebateProgress>(`/rebate/progress${qs ? `?${qs}` : ''}`)
}

export async function claimRebate(currency?: string): Promise<{ claimed: number; totalRebate: number }> {
  return apiRequest<{ claimed: number; totalRebate: number }>('/rebate/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currency }),
  })
}

export async function fetchRebateSummary(date: 'today' | 'yesterday', currency?: string): Promise<RebateSummary> {
  const params = new URLSearchParams({ date })
  if (currency) params.set('currency', currency)
  return apiRequest<RebateSummary>(`/rebate/summary?${params}`)
}
