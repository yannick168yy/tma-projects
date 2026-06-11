export type DepositCurrency = 'PHP' | 'USDT' | 'TON' | 'BTC' | 'TRX_TESTNET' | 'TLK_TESTNET'

export interface MatrixPayMethod {
  matrixSymbol: string
  matrixChain: string
}
