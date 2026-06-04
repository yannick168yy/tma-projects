import { apiRequest } from '@/api/client'

export interface BetRound {
  roundId: string | null
  betAmount: number
  winAmount: number
  currencyCode: string
  createdAt: string | null
  gameName: string | null
  gameNameZh: string | null
  gameNameVi: string | null
  gameNameId: string | null
  gameProvider: string | null
  gameImage: string | null
  gameImageHq: string | null
}

export interface BetHistoryPage {
  total: number
  page: number
  pageSize: number
  items: BetRound[]
}

export async function fetchBets(page: number, pageSize = 20, dateFrom?: string): Promise<BetHistoryPage> {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (dateFrom) qs.set('dateFrom', dateFrom)
  return apiRequest<BetHistoryPage>(`/bets?${qs.toString()}`)
}
