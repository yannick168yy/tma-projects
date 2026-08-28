export type DepositCurrency = 'PHP' | 'IDR' | 'USDT' | 'USDC' | 'TRX_TESTNET'

export interface MatrixPayMethod {
  matrixSymbol: string
  matrixChain: string
}
