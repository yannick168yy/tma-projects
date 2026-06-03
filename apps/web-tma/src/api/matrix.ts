import { apiRequest } from '@/api/client'

export interface MatrixDepositAddress {
  address: string
  symbol: string
  chain: string
}

export interface MatrixWithdrawResult {
  orderId: string
  status: string
  merchantOrderNo: string
  matrixOrderNo: string
}

export function fetchMatrixDepositAddress(symbol: string, chain: string): Promise<MatrixDepositAddress> {
  return apiRequest<MatrixDepositAddress>(
    `/deposits/matrix/address?symbol=${encodeURIComponent(symbol)}&chain=${encodeURIComponent(chain)}`,
  )
}

export function createMatrixWithdrawal(opts: {
  toAddress: string
  symbol: string
  chain: string
  cryptoAmount: string
  amount: number
}): Promise<MatrixWithdrawResult> {
  return apiRequest<MatrixWithdrawResult>('/withdrawals', {
    method: 'POST',
    body: JSON.stringify({ ...opts, channelId: 'matrix' }),
  })
}
