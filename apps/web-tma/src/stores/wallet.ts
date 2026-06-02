import { create } from 'zustand'
import { fetchBalance } from '@/api/wallet'
import type { WalletBalance } from '@/types/api'

interface WalletState {
  balance: WalletBalance | null
  loading: boolean
}

interface WalletActions {
  setBalance: (balance: WalletBalance) => void
  refresh: () => Promise<void>
  reset: () => void
}

export const useWalletStore = create<WalletState & WalletActions>((set) => ({
  balance: null,
  loading: false,

  get displayPhp() {
    return (useWalletStore.getState().balance?.displayPhp) ?? '₱ —'
  },

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
}))

export function getDisplayPhp(): string {
  return useWalletStore.getState().balance?.displayPhp ?? '₱ —'
}
