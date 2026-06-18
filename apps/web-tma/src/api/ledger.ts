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

export async function fetchLedger(page = 1, type = 'all'): Promise<LedgerResponse> {
  const params = new URLSearchParams({ page: String(page), type })
  return apiRequest<LedgerResponse>(`/ledger?${params.toString()}`)
}
