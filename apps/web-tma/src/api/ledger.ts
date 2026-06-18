import { apiRequest } from '@/api/client'

export interface LedgerItem {
  id: string
  type: string
  currency: string
  amount: number
  balanceAfter: number
  description: string
  createdAt: string
}

export interface LedgerResponse {
  items: LedgerItem[]
  total: number
  page: number
  pageSize: number
}

export async function fetchLedger(page = 1, dateFrom?: string, types?: string[]): Promise<LedgerResponse> {
  const params = new URLSearchParams({ page: String(page) })
  if (dateFrom) params.set('dateFrom', dateFrom)
  if (types?.length) params.set('types', types.join(','))
  return apiRequest<LedgerResponse>(`/ledger?${params.toString()}`)
}
