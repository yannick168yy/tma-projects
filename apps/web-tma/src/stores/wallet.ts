import { defineStore } from 'pinia'
import { fetchBalance } from '@/api/wallet'
import type { WalletBalance } from '@/types/api'

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    balance: null as WalletBalance | null,
    loading: false,
  }),

  getters: {
    displayPhp: (s) => s.balance?.displayPhp ?? '₱ —',
  },

  actions: {
    setBalance(balance: WalletBalance) {
      this.balance = balance
    },

    async refresh() {
      if (!localStorage.getItem('betogo_token')) return
      this.loading = true
      try {
        this.balance = await fetchBalance()
      } finally {
        this.loading = false
      }
    },
  },
})
