export type DepositCurrency = 'PHP' | 'USDT' | 'USDC' | 'TRX_TESTNET'

export interface MatrixPayMethod {
  matrixSymbol: string
  matrixChain: string
}
