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

export function formatCurrencyAmount(currency: string, available: number): string {
  if (currency === 'PHP') {
    return `₱ ${available.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `${available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

export function currencySymbol(currency: string): string {
  if (currency === 'PHP') return '₱'
  if (currency === 'USDT') return '$'
  if (currency === 'TON') return '◈'
  return currency.slice(0, 3)
}
