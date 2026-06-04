import { apiRequest } from '@/api/client'

export interface BetRecord {
  id: number
  roundId: string | null
  providerId: string | null
  betType: 'bet' | 'win' | 'refund' | 'rollback'
  amount: number
  currencyCode: string
  status: string
  createdAt: string | null
}

export interface BetHistoryPage {
  total: number
  page: number
  pageSize: number
  items: BetRecord[]
}

export async function fetchBets(page: number, pageSize = 20): Promise<BetHistoryPage> {
  return apiRequest<BetHistoryPage>(`/bets?page=${page}&pageSize=${pageSize}`)
}
