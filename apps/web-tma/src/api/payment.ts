import { apiRequest } from '@/api/client'

export interface PaymentChannel {
  name: string
  label: string
  minAmount: number | null
  maxAmount: number | null
}

export interface PaymentDepositResult {
  merchantSerial: string
  platformId: string
  payUrl: string
  amount: number
  state: number
  provider: string
}

export interface PaymentWithdrawResult {
  merchantSerial: string
  amount: number
  status: string
  platformId: string | null
}

export interface PaymentOrder {
  merchantSerial: string
  amount: number
  channelName: string
  provider: string
  state: number
  payUrl?: string
  createdAt: string
}

export async function fetchPaymentChannels(txType: 'deposit' | 'withdraw', currency = 'PHP'): Promise<PaymentChannel[]> {
  return apiRequest<PaymentChannel[]>(`/payment/channels?txType=${txType}&currency=${currency}`)
}

export interface CryptoChannelState {
  name: string
  label: string
  enabled: boolean
  sortOrder: number
}

export async function fetchCryptoChannels(): Promise<CryptoChannelState[]> {
  return apiRequest<CryptoChannelState[]>('/payment/crypto-channels')
}

export async function createPaymentDeposit(params: {
  channelName: string
  amount: number
}): Promise<PaymentDepositResult> {
  return apiRequest<PaymentDepositResult>('/payment/deposit/create', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function queryPaymentDeposit(merchantSerial: string): Promise<{ state: number }> {
  return apiRequest('/payment/deposit/query', {
    method: 'POST',
    body: JSON.stringify({ merchantSerial }),
  })
}

export async function fetchPaymentDepositOrders(): Promise<PaymentOrder[]> {
  return apiRequest<PaymentOrder[]>('/payment/deposit/orders')
}

export async function createPaymentWithdrawal(params: {
  channelName: string
  amount: number
  targetOwner: string
  targetAccount: string
}): Promise<PaymentWithdrawResult> {
  return apiRequest<PaymentWithdrawResult>('/payment/withdraw/create', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function fetchPaymentWithdrawOrders(): Promise<PaymentOrder[]> {
  return apiRequest<PaymentOrder[]>('/payment/withdraw/orders')
}
