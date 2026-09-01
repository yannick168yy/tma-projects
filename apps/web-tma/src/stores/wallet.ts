import { create } from 'zustand'
import { fetchBalance } from '@/api/wallet'
import { getToken } from '@/utils/tokenStore'
import type { WalletBalance } from '@/types/api'
import { defaultMarketCurrency } from '@/config/market'

interface WalletState {
  balance: WalletBalance | null
  loading: boolean
  activeCurrency: string
}

interface WalletActions {
  setBalance: (balance: WalletBalance) => void
  refresh: () => Promise<void>
  reset: () => void
  setActiveCurrency: (currency: string, manual?: boolean) => void
}

const CURRENCY_KEY = 'betogo_currency'
// 用户在钱包里手动选过币种后就不再自动纠正，否则会和用户较劲（选回去又被改掉）
const CURRENCY_MANUAL_KEY = 'betogo_currency_manual'

/**
 * activeCurrency 的初值来自界面语言或域名市场，跟用户实际有钱的钱包没有关系。
 * 而进游戏是按 activeCurrency 选 568Win 账号的（每种法币一个独立账号），选错币种
 * 就会用一个空账号启动，玩家看到带入金额是 0。这里在余额到手后做一次纠正。
 */
function reconcileCurrency(current: string, balance: WalletBalance): string | null {
  if (localStorage.getItem(CURRENCY_MANUAL_KEY)) return null
  const fiat = balance.balances.filter((item) => isFiatCurrency(item.currency))
  if (fiat.some((item) => item.currency === current && item.available > 0)) return null
  const funded = fiat.filter((item) => item.available > 0)
  return funded.length === 1 && funded[0].currency !== current ? funded[0].currency : null
}

export const useWalletStore = create<WalletState & WalletActions>((set, get) => ({
  balance: null,
  loading: false,
  activeCurrency: localStorage.getItem(CURRENCY_KEY) ?? defaultMarketCurrency(),

  setBalance(balance) {
    const corrected = reconcileCurrency(get().activeCurrency, balance)
    if (corrected) localStorage.setItem(CURRENCY_KEY, corrected)
    set(corrected ? { balance, activeCurrency: corrected } : { balance })
  },

  async refresh() {
    if (!getToken()) return
    set({ loading: true })
    try {
      get().setBalance(await fetchBalance())
    } finally {
      set({ loading: false })
    }
  },

  reset() {
    set({ balance: null, loading: false })
  },

  setActiveCurrency(currency, manual = false) {
    localStorage.setItem(CURRENCY_KEY, currency)
    if (manual) localStorage.setItem(CURRENCY_MANUAL_KEY, '1')
    set({ activeCurrency: currency })
  },
}))

export function getDisplayPhp(): string {
  return useWalletStore.getState().balance?.displayPhp ?? '₱ —'
}

// 预设支持的币种顺序
// 仅保留 PHP + 稳定币(USDT/USDC)；TRX_TESTNET 为测试链，仅充值用，由 AppShell 按余额单独插入
export const SUPPORTED_CURRENCY_CODES = ['PHP', 'IDR', 'USDT', 'USDC'] as const

export const FIAT_CURRENCY_CODES = ['PHP', 'IDR'] as const

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
  IDR:         { code: 'IDR',         name: 'Indonesian Rupiah', symbol: 'Rp' },
  USDT:        { code: 'USDT',        name: 'Tether USD',      symbol: '₮' },
  USDC:        { code: 'USDC',        name: 'USD Coin',        symbol: '$' },
  TRX_TESTNET: { code: 'TRX_TESTNET', name: 'Tron',            symbol: 'T', isTestnet: true },
}

// 头部 chip 余额：法币带本地符号，其他只显示数字（chip 标签已含币种代码）
export function formatHeaderBalance(currency: string, available: number): string {
  if (currency === 'PHP') {
    return `₱ ${available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (currency === 'IDR') {
    return `Rp ${available.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }
  return available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 列表行金额：只显示数字，不重复币种代码
export function formatRowAmount(currency: string, available: number): string {
  if (currency === 'PHP') {
    return `₱ ${available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (currency === 'IDR') {
    return `Rp ${available.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }
  return available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 完整格式，含币种代码（用于其他地方）
export function formatCurrencyAmount(currency: string, available: number): string {
  if (currency === 'PHP') {
    return `₱ ${available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (currency === 'IDR') {
    return `Rp ${available.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }
  return `${available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

/** 充提/币种列表：币种代码在前，如 PHP 1,234.56 */
export function formatBalanceWithCode(currency: string, available: number): string {
  const code = displayCurrencyCode(currency)
  const num =
    currency === 'PHP'
      ? available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : currency === 'IDR'
        ? available.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${code} ${num}`
}

export function currencySymbol(currency: string): string {
  return CURRENCY_META[currency]?.symbol ?? currency.slice(0, 3)
}
