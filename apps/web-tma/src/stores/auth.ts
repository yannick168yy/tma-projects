import { create } from 'zustand'
import { loginTelegram, loginWithGoogleRedirect, logoutSession, restoreSession } from '@/api/auth'
import { getInitData } from '@/api/client'
import { fetchBalance } from '@/api/wallet'
import { fetchPromoHighlights } from '@/api/promotion'
import { usePromotionStore } from '@/stores/promotion'
import { useWalletStore } from '@/stores/wallet'
import type { AuthUser } from '@/types/api'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'
import { clearStoredReferral } from '@/utils/referral'
import { i18n } from '@/i18n'

export type AuthPhase = 'splash' | 'ready' | 'error'

interface AuthState {
  phase: AuthPhase
  bootError: string | null
  token: string | null
  user: AuthUser | null
  isNewUser: boolean
  trialEligible: boolean
  loginSheetOpen: boolean
  loginReason: string | null
  isTelegram: boolean
  tgAutoLoginAttempted: boolean
}

interface AuthActions {
  bootstrap: () => Promise<void>
  tryTelegramAutoLogin: () => Promise<void>
  applySession: (session: { token: string; user: AuthUser; isNewUser: boolean; trialRedPacketEligible?: boolean }) => void
  ensureLoggedIn: (reason: string) => Promise<boolean>
  requireLogin: (reason: string) => boolean
  closeLoginSheet: () => void
  clearTrialEligible: () => void
  loginWithTelegram: () => Promise<void>
  loginWithGoogle: () => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  phase: 'splash',
  bootError: null,
  token: null,
  user: null,
  isNewUser: false,
  trialEligible: false,
  loginSheetOpen: false,
  loginReason: null,
  isTelegram: isInsideTelegram(),
  tgAutoLoginAttempted: false,

  async bootstrap() {
    set({ phase: 'splash', bootError: null, isTelegram: isInsideTelegram() })
    const wallet = useWalletStore.getState()
    const promotion = usePromotionStore.getState()

    try {
      const token = localStorage.getItem('betogo_token')
      if (token) {
        const session = await restoreSession()
        if (session) {
          get().applySession(session)
        } else {
          localStorage.removeItem('betogo_token')
        }
      }

      if (get().isTelegram && getInitData()) {
        await get().tryTelegramAutoLogin()
      }

      if (get().token && get().user) {
        promotion.setHighlights(await fetchPromoHighlights())
        wallet.setBalance(await fetchBalance())
      }
    } catch (e) {
      set({ bootError: e instanceof Error ? e.message : i18n.t('auth.startupFailed') })
    } finally {
      set({ phase: 'ready' })
    }
  },

  async tryTelegramAutoLogin() {
    if (!get().isTelegram || !getInitData()) return
    set({ tgAutoLoginAttempted: true })
    try {
      const session = await loginTelegram()
      get().applySession(session)
    } catch { /* 保留当前会话或访客模式 */ }
  },

  applySession(session) {
    set({
      token: session.token,
      user: session.user,
      isNewUser: session.isNewUser,
      trialEligible: Boolean(session.trialRedPacketEligible),
    })
    localStorage.setItem('betogo_token', session.token)
    if (session.isNewUser) {
      localStorage.setItem('betogo_seen', '1')
      clearStoredReferral()
      useWalletStore.getState().setActiveCurrency('PHP')
    }
  },

  async ensureLoggedIn(reason) {
    if (get().token && get().user) return true
    if (get().isTelegram && getInitData()) {
      await get().tryTelegramAutoLogin()
      if (get().token && get().user) return true
    }
    set({ loginReason: reason, loginSheetOpen: true })
    return false
  },

  requireLogin(reason) {
    void get().ensureLoggedIn(reason)
    return Boolean(get().token && get().user)
  },

  closeLoginSheet() {
    set({ loginSheetOpen: false, loginReason: null })
  },

  clearTrialEligible() {
    set({ trialEligible: false })
  },

  async loginWithTelegram() {
    const session = await loginTelegram()
    get().applySession(session)
    get().closeLoginSheet()
    useWalletStore.getState().setBalance(await fetchBalance())
    await usePromotionStore.getState().refreshHighlights()
  },

  loginWithGoogle() {
    loginWithGoogleRedirect()
  },

  async logout() {
    await logoutSession()
    set({
      token: null,
      user: null,
      isNewUser: false,
      trialEligible: false,
    })
    get().closeLoginSheet()
    localStorage.removeItem('betogo_token')
    useWalletStore.getState().reset()
    const promotion = usePromotionStore.getState()
    usePromotionStore.setState({
      highlights: [],
      referralRecords: [],
      redPacketRecords: [],
      redPacketSheet: { open: false, amountPhp: 0, title: '' },
    })
    // keep other promo state as-is
    void promotion
  },
}))
