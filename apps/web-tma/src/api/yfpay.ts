import { apiRequest } from '@/api/client'

export interface YfPayChannel {
  code: string
  name: string
  min: number
  max: number
}

export interface YfDepositResult {
  merchantSerial: string
  platformId: string
  payUrl: string
  amount: number
  state: number
}

export interface YfWithdrawResult {
  merchantSerial: string
  platformId: string
  amount: number
  state: number
}

export interface YfPayOrder {
  id: number
  merchantSerial: string
  platformId: string
  amountCents: number
  channelCode?: string
  optionCode?: string
  targetAccount?: string
  targetOwner?: string
  state: number
  createdAt: string
}

export async function fetchYfPayChannels(): Promise<YfPayChannel[]> {
  return apiRequest<YfPayChannel[]>('/deposit/yfpay/channels')
}

export async function createYfDeposit(amount: number, channelCode: string): Promise<YfDepositResult> {
  return apiRequest<YfDepositResult>('/deposit/yfpay/create', {
    method: 'POST',
    body: JSON.stringify({ amount, channelCode }),
  })
}

export async function queryYfDeposit(merchantSerial: string): Promise<{ state: number }> {
  return apiRequest('/deposit/yfpay/query', {
    method: 'POST',
    body: JSON.stringify({ merchantSerial }),
  })
}

export async function fetchYfDepositOrders(): Promise<YfPayOrder[]> {
  return apiRequest<YfPayOrder[]>('/deposit/yfpay/orders')
}

export async function createYfWithdrawal(params: {
  amount: number
  targetOwner: string
  targetAccount: string
  optionCode?: string
}): Promise<YfWithdrawResult> {
  return apiRequest<YfWithdrawResult>('/withdraw/yfpay/create', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function fetchYfWithdrawOrders(): Promise<YfPayOrder[]> {
  return apiRequest<YfPayOrder[]>('/withdraw/yfpay/orders')
}
