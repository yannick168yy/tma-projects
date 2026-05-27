import { apiRequest } from '@/api/client'

export interface TonDepositOrder {
  orderId: string
  merchantAddress: string
  amountNano: string
  expiresAt: string
  phpEquivalent: number
  devSettled?: boolean
}

export interface TonDepositStatus {
  orderId: string
  status: 'pending' | 'paid' | 'failed' | 'cancelled'
  txHash?: string
  creditedCents?: number
}

export async function createTonDeposit(
  amountTon: number,
  walletAddress: string,
): Promise<TonDepositOrder> {
  return apiRequest<TonDepositOrder>('/deposits/ton', {
    method: 'POST',
    body: JSON.stringify({ amount: amountTon, walletAddress }),
  })
}

export async function pollTonDepositStatus(orderId: string): Promise<TonDepositStatus> {
  return apiRequest<TonDepositStatus>(`/deposits/ton/${encodeURIComponent(orderId)}/status`)
}
