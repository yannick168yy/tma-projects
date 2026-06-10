import { apiRequest } from '@/api/client'
import * as mock from '@/api/mock/wallet.mock'
import type { WalletBalance, CurrencyBalance } from '@/types/api'

const useMock = import.meta.env.VITE_USE_MOCK_API !== 'false'

export interface TurnoverRequirement {
  id: number
  sourceType: string
  sourceRef: string
  currency: string
  requiredAmount: number
  completedAmount: number
  status: string
  expiresAt: string | null
  createdAt: string
}

export interface TurnoverProgress {
  canWithdraw: boolean
  totalRemaining: number
  requirements: TurnoverRequirement[]
}

export async function fetchTurnoverProgress(currency?: string): Promise<TurnoverProgress> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : ''
  return apiRequest<TurnoverProgress>(`/turnover${qs}`)
}

export async function fetchBalance(): Promise<WalletBalance> {
  if (useMock) return mock.mockGetBalance()
  const list = await apiRequest<CurrencyBalance[]>('/wallet/balances')
  const php = list.find((b) => b.currency === 'PHP')
  const amount = php?.available ?? 0
  return {
    currency: 'PHP',
    availableCents: amount,
    frozenCents: php?.frozen ?? 0,
    displayPhp: `₱ ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    balances: list,
  }
}

export async function creditWallet(cents: number): Promise<WalletBalance> {
  if (useMock) return mock.mockCredit(cents)
  return fetchBalance()
}
