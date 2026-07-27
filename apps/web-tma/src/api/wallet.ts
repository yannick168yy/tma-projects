import { apiRequest } from '@/api/client'
import * as mock from '@/api/mock/wallet.mock'
import type { WalletBalance, CurrencyBalance } from '@/types/api'

// 显式 'true' 才启用 mock：构建变量缺失时绝不能默认走假数据
const useMock = import.meta.env.VITE_USE_MOCK_API === 'true'

export interface TurnoverRequirement {
  id: number
  sourceType: string
  sourceRef: string
  currency: string
  baseAmount: number
  requiredAmount: number
  completedAmount: number
  status: string
  expiresAt: string | null
  createdAt: string
}

export interface TurnoverProgress {
  canWithdraw: boolean
  totalRemaining: number
  /** 存款类要求剩余流水，>0 时后端禁止任何提现 */
  depositRemaining: number
  /** 未解锁彩金本金合计：可提现金额 = 余额 - lockedBonus */
  lockedBonus: number
  /** 是否有过已支付存款订单（存款引导分支判定） */
  hasDeposit: boolean
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
