import { apiRequest } from '@/api/client'

export type CheckinTier = 'starter' | 'premium' | 'elite'

export interface SpinDepositRule {
  id?: number
  kind?: 'deposit' | 'checkin'
  checkinTier?: CheckinTier | null
  name: string
  minDepositPhp: number
  depositAmountPhp?: number
  maxDepositPhp: number | null
  chances: number
  enabled: boolean
  sortOrder: number
  remainingChances?: number
}

export interface SpinPrize {
  id?: number
  ruleId?: number | null
  currency?: string
  name: string
  imageKey: string
  amountPhp: number
  weight: number
  turnoverX: number
  enabled: boolean
  sortOrder: number
}

export interface SpinRecord {
  id: string
  userId: string
  displayName: string
  prizeName: string
  amountPhp: number
  currency?: string
  createdAt: string
}

export interface SpinStatus {
  enabled: boolean
  remainingChances: number
  depositRules: SpinDepositRule[]
  prizes: SpinPrize[]
  recentRecords: SpinRecord[]
  tickerRecords: SpinRecord[]
}

export interface SpinDrawResult {
  recordId: string
  prizeId: number
  prizeName: string
  amountPhp: number
  currency?: string
  remainingChances: number
}

export interface SpinRecordsResult {
  items: SpinRecord[]
  total: number
  page: number
  pageSize: number
}

export function fetchSpinStatus(ruleId?: number, currency?: string): Promise<SpinStatus> {
  const p = new URLSearchParams()
  if (ruleId) p.set('ruleId', String(ruleId))
  if (currency) p.set('currency', currency)
  const qs = p.toString()
  return apiRequest<SpinStatus>(`/spin/status${qs ? `?${qs}` : ''}`)
}

export function drawSpin(ruleId: number, currency?: string): Promise<SpinDrawResult> {
  return apiRequest<SpinDrawResult>('/spin/draw', { method: 'POST', body: JSON.stringify({ ruleId, currency }) })
}

export function fetchSpinRecords(page = 1, pageSize = 20): Promise<SpinRecordsResult> {
  return apiRequest<SpinRecordsResult>(`/spin/records?page=${page}&pageSize=${pageSize}`)
}
