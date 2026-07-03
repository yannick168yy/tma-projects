import { create } from 'zustand'
import { fetchBalance } from '@/api/wallet'
import type { WalletBalance } from '@/types/api'

interface WalletState {
  balance: WalletBalance | null
  loading: boolean
  activeCurrency: string
}

interface WalletActions {
  setBalance: (balance: WalletBalance) => void
  refresh: () => Promise<void>
  reset: () => void
  setActiveCurrency: (currency: string) => void
}

export const useWalletStore = create<WalletState & WalletActions>((set) => ({
  balance: null,
  loading: false,
  activeCurrency: localStorage.getItem('betogo_currency') ?? 'PHP',

  setBalance(balance) {
    set({ balance })
  },

  async refresh() {
    if (!localStorage.getItem('betogo_token')) return
    set({ loading: true })
    try {
      const balance = await fetchBalance()
      set({ balance })
    } finally {
      set({ loading: false })
    }
  },

  reset() {
    set({ balance: null, loading: false })
  },

  setActiveCurrency(currency) {
    localStorage.setItem('betogo_currency', currency)
    set({ activeCurrency: currency })
  },
}))

export function getDisplayPhp(): string {
  return useWalletStore.getState().balance?.displayPhp ?? '₱ —'
}

// 预设支持的币种顺序
export const SUPPORTED_CURRENCY_CODES = ['PHP', 'USDT', 'USDC', 'TON', 'TRX', 'BNB', 'ETH', 'BTC'] as const

export const FIAT_CURRENCY_CODES = ['PHP'] as const

export function isFiatCurrency(code: string): boolean {
  return (FIAT_CURRENCY_CODES as readonly string[]).includes(code)
}

export function displayCurrencyCode(code: string): string {
  if (code === 'UCC') return 'USDT'
  return code === 'TRX_TESTNET' ? 'TRX' : code
}

export interface CurrencyMeta {
  code: string
  name: string
  symbol: string
  isTestnet?: boolean
}

export const CURRENCY_META: Record<string, CurrencyMeta> = {
  PHP:         { code: 'PHP',         name: 'Philippine Peso', symbol: '₱' },
  USDT:        { code: 'USDT',        name: 'Tether USD',      symbol: '₮' },
  USDC:        { code: 'USDC',        name: 'USD Coin',        symbol: '$' },
  TON:         { code: 'TON',         name: 'Toncoin',         symbol: '◈' },
  TRX:         { code: 'TRX',         name: 'Tron',            symbol: 'T' },
  TRX_TESTNET: { code: 'TRX_TESTNET', name: 'Tron',            symbol: 'T', isTestnet: true },
  BNB:         { code: 'BNB',         name: 'BNB',             symbol: 'B' },
  ETH:         { code: 'ETH',         name: 'Ethereum',        symbol: 'Ξ' },
  BTC:         { code: 'BTC',         name: 'Bitcoin',         symbol: '₿' },
}

// 头部 chip 余额：PHP 带 ₱ 符号，其他只显示数字（chip 标签已含币种代码）
export function formatHeaderBalance(currency: string, available: number): string {
  if (currency === 'PHP') {
    return `₱ ${available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 列表行金额：只显示数字，不重复币种代码
export function formatRowAmount(currency: string, available: number): string {
  if (currency === 'PHP') {
    return `₱ ${available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 完整格式，含币种代码（用于其他地方）
export function formatCurrencyAmount(currency: string, available: number): string {
  if (currency === 'PHP') {
    return `₱ ${available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `${available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

/** 充提/币种列表：币种代码在前，如 PHP 1,234.56 */
export function formatBalanceWithCode(currency: string, available: number): string {
  const code = displayCurrencyCode(currency)
  const num =
    currency === 'PHP'
      ? available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${code} ${num}`
}

export function currencySymbol(currency: string): string {
  return CURRENCY_META[currency]?.symbol ?? currency.slice(0, 3)
}
