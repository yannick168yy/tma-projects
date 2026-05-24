import { defineStore } from 'pinia'
import { loginTelegram, loginWithGoogleRedirect, logoutSession, restoreSession } from '@/api/auth'
import { fetchBalance } from '@/api/wallet'
import { fetchPromoHighlights } from '@/api/promotion'
import { usePromotionStore } from '@/stores/promotion'
import { useWalletStore } from '@/stores/wallet'
import type { AuthUser } from '@/types/api'
import { isTelegramWebApp } from '@/api/client'

export type AuthPhase = 'splash' | 'ready' | 'error'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    phase: 'splash' as AuthPhase,
    bootError: null as string | null,
    token: null as string | null,
    user: null as AuthUser | null,
    isNewUser: false,
    trialEligible: false,
    loginSheetOpen: false,
    loginReason: null as string | null,
    isTelegram: isTelegramWebApp(),
  }),

  getters: {
    isLoggedIn: (s) => Boolean(s.token && s.user),
  },

  actions: {
    async bootstrap() {
      this.phase = 'splash'
      this.bootError = null
      const wallet = useWalletStore()
      const promotion = usePromotionStore()
      try {
        const session = await restoreSession()
        if (session) this.applySession(session)
        if (this.isLoggedIn) {
          promotion.setHighlights(await fetchPromoHighlights())
          wallet.setBalance(await fetchBalance())
        }
      } catch (e) {
        this.bootError = e instanceof Error ? e.message : 'Startup failed'
      } finally {
        this.phase = 'ready'
      }
    },

    applySession(session: {
      token: string
      user: AuthUser
      isNewUser: boolean
      trialRedPacketEligible?: boolean
    }) {
      this.token = session.token
      this.user = session.user
      this.isNewUser = session.isNewUser
      this.trialEligible = Boolean(session.trialRedPacketEligible)
      localStorage.setItem('betogo_token', session.token)
      if (session.isNewUser) localStorage.setItem('betogo_seen', '1')
    },

    requireLogin(reason: string) {
      if (this.isLoggedIn) return true
      this.loginReason = reason
      this.loginSheetOpen = true
      return false
    },

    closeLoginSheet() {
      this.loginSheetOpen = false
      this.loginReason = null
    },

    async loginWithTelegram() {
      const session = await loginTelegram()
      this.applySession(session)
      this.closeLoginSheet()
      useWalletStore().setBalance(await fetchBalance())
      await usePromotionStore().refreshHighlights()
    },

    loginWithGoogle() {
      loginWithGoogleRedirect()
    },

    async logout() {
      await logoutSession()
      this.token = null
      this.user = null
      this.isNewUser = false
      this.trialEligible = false
      this.closeLoginSheet()
      localStorage.removeItem('betogo_token')
      useWalletStore().$patch({ balance: null, loading: false })
      usePromotionStore().$patch({
        highlights: [],
        referralRecords: [],
        redPacketRecords: [],
        redPacketSheet: { open: false, amountPhp: 0, title: '' },
      })
    },
  },
})
