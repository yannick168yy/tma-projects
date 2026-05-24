import { apiRequest } from '@/api/client'
import type { DepositCurrency } from '@/types/wallet'

export type CreateDepositResult = {
  orderId: string
  status: string
  currency: DepositCurrency
  invoiceLink?: string
}

export type DepositOrderStatus = {
  orderId: string
  status: string
  amount: number
  currency: DepositCurrency
  paidAmount?: number
}

export async function createDeposit(
  amount: number,
  currency: DepositCurrency,
): Promise<CreateDepositResult> {
  return apiRequest<CreateDepositResult>('/deposits', {
    method: 'POST',
    body: JSON.stringify({ amount, currency, channelId: 'tg_wallet' }),
  })
}

export async function fetchDepositOrder(orderId: string): Promise<DepositOrderStatus> {
  return apiRequest<DepositOrderStatus>(`/deposits/${encodeURIComponent(orderId)}`)
}
