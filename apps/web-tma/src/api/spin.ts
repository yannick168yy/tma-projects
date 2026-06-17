import { apiRequest } from '@/api/client'

export interface SpinDepositRule {
  id?: number
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
  remainingChances: number
}

export function fetchSpinStatus(ruleId?: number): Promise<SpinStatus> {
  const qs = ruleId ? `?ruleId=${ruleId}` : ''
  return apiRequest<SpinStatus>(`/spin/status${qs}`)
}

export function drawSpin(ruleId: number): Promise<SpinDrawResult> {
  return apiRequest<SpinDrawResult>('/spin/draw', { method: 'POST', body: JSON.stringify({ ruleId }) })
}
