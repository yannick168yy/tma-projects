import { create } from 'zustand'
import { loginPassword, loginTelegram, loginTelegramWidget, loginWithGoogleRedirect, logoutSession, registerPassword, restoreSession } from '@/api/auth'
import { getInitData } from '@/api/client'
import { fetchBalance } from '@/api/wallet'
import { fetchPromoHighlights } from '@/api/promotion'
import { usePromotionStore } from '@/stores/promotion'
import { useWalletStore } from '@/stores/wallet'
import type { AuthUser } from '@/types/api'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'
import { clearStoredReferral, getStoredReferral } from '@/utils/referral'
import type { PasswordMethod, TelegramWidgetUser } from '@/types/api'

const LOGOUT_FLAG = 'betogo_logged_out'
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
  loginWithTelegramWidget: (data: TelegramWidgetUser) => Promise<void>
  loginWithGoogle: () => void
  loginWithPassword: (method: PasswordMethod, identifier: string, password: string) => Promise<void>
  registerWithPassword: (method: PasswordMethod, identifier: string, password: string) => Promise<void>
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
    if (localStorage.getItem(LOGOUT_FLAG)) return // 手动登出后不自动用 TG 登录，让用户选其他方式
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
    localStorage.removeItem(LOGOUT_FLAG) // 成功登录后解除登出抑制
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

  async loginWithTelegramWidget(data) {
    const session = await loginTelegramWidget(data)
    get().applySession(session)
    get().closeLoginSheet()
    useWalletStore.getState().setBalance(await fetchBalance())
    await usePromotionStore.getState().refreshHighlights()
  },

  loginWithGoogle() {
    loginWithGoogleRedirect()
  },

  async loginWithPassword(method, identifier, password) {
    const session = await loginPassword(method, identifier, password)
    get().applySession(session)
    get().closeLoginSheet()
    useWalletStore.getState().setBalance(await fetchBalance())
    await usePromotionStore.getState().refreshHighlights()
  },

  async registerWithPassword(method, identifier, password) {
    const session = await registerPassword(method, identifier, password, getStoredReferral() ?? undefined)
    get().applySession(session)
    get().closeLoginSheet()
    useWalletStore.getState().setBalance(await fetchBalance())
    await usePromotionStore.getState().refreshHighlights()
  },

  async logout() {
    await logoutSession()
    localStorage.setItem(LOGOUT_FLAG, '1') // 抑制 TG 自动登录，允许改用其他方式
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
