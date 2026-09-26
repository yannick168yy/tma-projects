export type DepositCurrency = 'PHP' | 'IDR' | 'INR' | 'USDT' | 'USDC' | 'TRX_TESTNET'

export interface MatrixPayMethod {
  matrixSymbol: string
  matrixChain: string
}
