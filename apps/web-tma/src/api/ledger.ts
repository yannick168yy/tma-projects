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

export async function fetchLedger(page = 1): Promise<{ items: LedgerItem[]; page: number }> {
  return apiRequest<{ items: LedgerItem[]; page: number }>(`/ledger?page=${page}`)
}
