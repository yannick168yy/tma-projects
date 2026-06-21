export type DepositCurrency = 'PHP' | 'USDT' | 'USDC' | 'TON' | 'TRX' | 'BTC' | 'TRX_TESTNET' | 'TLK_TESTNET'

export interface MatrixPayMethod {
  matrixSymbol: string
  matrixChain: string
}
