import { defineStore } from 'pinia'
import { i18n } from '@/i18n'
import { loginTelegram, loginWithGoogleRedirect, logoutSession, restoreSession } from '@/api/auth'
import { getInitData } from '@/api/client'
import { fetchBalance } from '@/api/wallet'
import { fetchPromoHighlights } from '@/api/promotion'
import { usePromotionStore } from '@/stores/promotion'
import { useWalletStore } from '@/stores/wallet'
import type { AuthUser } from '@/types/api'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'

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
    isTelegram: isInsideTelegram(),
    tgAutoLoginAttempted: false,
  }),

  getters: {
    isLoggedIn: (s) => Boolean(s.token && s.user),
    loginProvider: (s) => s.user?.loginProvider,
  },

  actions: {
    async bootstrap() {
      this.phase = 'splash'
      this.bootError = null
      this.isTelegram = isInsideTelegram()
      const wallet = useWalletStore()
      const promotion = usePromotionStore()

      try {
        const token = localStorage.getItem('betogo_token')
        if (token) {
          const session = await restoreSession()
          if (session) {
            this.applySession(session)
          } else {
            localStorage.removeItem('betogo_token')
          }
        }

        if (this.isTelegram && getInitData()) {
          await this.tryTelegramAutoLogin()
        }

        if (this.isLoggedIn) {
          promotion.setHighlights(await fetchPromoHighlights())
          wallet.setBalance(await fetchBalance())
        }
      } catch (e) {
        this.bootError = e instanceof Error ? e.message : i18n.global.t('auth.startupFailed')
      } finally {
        this.phase = 'ready'
      }
    },

    /** Telegram Mini App: sign in silently on launch using initData. */
    async tryTelegramAutoLogin() {
      if (!this.isTelegram || !getInitData()) return
      this.tgAutoLoginAttempted = true
      try {
        const session = await loginTelegram()
        this.applySession(session)
      } catch {
        // Keep restored session or guest mode; user can retry from login sheet if needed.
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

    async ensureLoggedIn(reason: string): Promise<boolean> {
      if (this.isLoggedIn) return true
      if (this.isTelegram && getInitData()) {
        await this.tryTelegramAutoLogin()
        if (this.isLoggedIn) return true
      }
      this.loginReason = reason
      this.loginSheetOpen = true
      return false
    },

    requireLogin(reason: string) {
      void this.ensureLoggedIn(reason)
      return this.isLoggedIn
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
