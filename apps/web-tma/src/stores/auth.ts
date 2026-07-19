import { create } from 'zustand'
import { loginPassword, loginTelegram, loginTelegramWidget, loginWithGoogleRedirect, loginWithTelegramRedirect, logoutSession, registerPassword, restoreSession, TRIAL_CLAIMED_KEY } from '@/api/auth'
import { getInitData } from '@/api/client'
import { fetchBalance } from '@/api/wallet'
import { fetchPromoHighlights } from '@/api/promotion'
import { usePromotionStore } from '@/stores/promotion'
import { useWalletStore } from '@/stores/wallet'
import type { AuthUser } from '@/types/api'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'
import { clearStoredReferral, getStoredReferral } from '@/utils/referral'
import { isRememberMeEnabled, saveLastLogin } from '@/utils/lastLogin'
import { analytics, setAnalyticsUser } from '@/utils/analytics'
import type { LoginProvider, PasswordMethod, TelegramWidgetUser } from '@/types/api'

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
  applySession: (session: { token: string; user: AuthUser; isNewUser: boolean; trialRedPacketEligible?: boolean }, loginMethod?: LoginProvider) => void
  ensureLoggedIn: (reason: string) => Promise<boolean>
  requireLogin: (reason: string) => boolean
  closeLoginSheet: () => void
  clearTrialEligible: () => void
  loginWithTelegram: () => Promise<void>
  loginWithTelegramWidget: (data: TelegramWidgetUser) => Promise<void>
  loginWithGoogle: () => void
  loginWithTelegramOidc: () => void
  loginWithPassword: (method: PasswordMethod, identifier: string, password: string) => Promise<void>
  loginOrRegisterWithPassword: (method: PasswordMethod, identifier: string, password: string, refCodeOverride?: string, turnstileToken?: string) => Promise<void>
  registerWithPassword: (method: PasswordMethod, identifier: string, password: string, refCodeOverride?: string, turnstileToken?: string) => Promise<void>
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
        const [highlights, balance] = await Promise.all([fetchPromoHighlights(), fetchBalance()])
        promotion.setHighlights(highlights)
        wallet.setBalance(balance)
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
      get().applySession(session, 'telegram')
    } catch { /* 保留当前会话或访客模式 */ }
  },

  applySession(session, loginMethod) {
    setAnalyticsUser(session.user)
    set({
      token: session.token,
      user: session.user,
      isNewUser: session.isNewUser,
      trialEligible: Boolean(session.trialRedPacketEligible),
    })
    localStorage.setItem('betogo_token', session.token)
    localStorage.removeItem(LOGOUT_FLAG) // 成功登录后解除登出抑制
    // 记住"本次实际使用"的登录方式，供下次打开登录框快捷续登；只记身份标识，不记密码。
    // 必须用 loginMethod（发起登录时确定），不能用 user.loginProvider——后者是后端按
    // 固定优先级(telegram>google>...)从已绑定身份推导的，多绑用户会恒为 telegram，导致
    // 上次用 Google 登录却提示"继续用 Telegram"。boot/restore 无本次方式，不覆写记录。
    if (loginMethod) {
      const identifier = loginMethod === 'phone' ? session.user.phone : undefined
      saveLastLogin({
        provider: loginMethod,
        identifier: isRememberMeEnabled() ? identifier : undefined,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      })
    }
    // 用权威资格同步本地试玩标记，供下次恢复会话时决定是否跳过 trial-play 请求
    if (session.trialRedPacketEligible) localStorage.removeItem(TRIAL_CLAIMED_KEY)
    else localStorage.setItem(TRIAL_CLAIMED_KEY, '1')
    if (session.isNewUser) {
      localStorage.setItem('betogo_seen', '1')
      clearStoredReferral()
    }
    // 首次登录默认选中 PHP：一次性标记，避免覆盖用户之后手动切换的币种
    if (!localStorage.getItem('betogo_currency_init')) {
      localStorage.setItem('betogo_currency_init', '1')
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
    localStorage.setItem(TRIAL_CLAIMED_KEY, '1')
    set({ trialEligible: false })
  },

  async loginWithTelegram() {
    analytics.loginStart('telegram')
    const session = await loginTelegram()
    get().applySession(session, 'telegram')
    analytics.loginSuccess(session.user.loginProvider ?? 'telegram', session.isNewUser)
    get().closeLoginSheet()
    useWalletStore.getState().setBalance(await fetchBalance())
    await usePromotionStore.getState().refreshHighlights()
  },

  async loginWithTelegramWidget(data) {
    analytics.loginStart('telegram')
    const session = await loginTelegramWidget(data)
    get().applySession(session, 'telegram')
    analytics.loginSuccess(session.user.loginProvider ?? 'telegram', session.isNewUser)
    get().closeLoginSheet()
    useWalletStore.getState().setBalance(await fetchBalance())
    await usePromotionStore.getState().refreshHighlights()
  },

  loginWithGoogle() {
    analytics.loginStart('google')
    loginWithGoogleRedirect()
  },

  loginWithTelegramOidc() {
    analytics.loginStart('telegram_oidc')
    loginWithTelegramRedirect()
  },

  async loginWithPassword(method, identifier, password) {
    analytics.loginStart(method)
    const session = await loginPassword(method, identifier, password)
    get().applySession(session, method)
    analytics.loginSuccess(session.user.loginProvider ?? method, session.isNewUser)
    get().closeLoginSheet()
    useWalletStore.getState().setBalance(await fetchBalance())
    await usePromotionStore.getState().refreshHighlights()
  },

  async loginOrRegisterWithPassword(method, identifier, password, refCodeOverride?: string, turnstileToken?: string) {
    try {
      await get().loginWithPassword(method, identifier, password)
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'Account not found') throw e
      await get().registerWithPassword(method, identifier, password, refCodeOverride, turnstileToken)
    }
  },

  async registerWithPassword(method, identifier, password, refCodeOverride?: string, turnstileToken?: string) {
    analytics.loginStart(method)
    const session = await registerPassword(method, identifier, password, refCodeOverride ?? getStoredReferral() ?? undefined, turnstileToken)
    get().applySession(session, method)
    analytics.loginSuccess(session.user.loginProvider ?? method, true)
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
    setAnalyticsUser(null)
    get().closeLoginSheet()
    localStorage.removeItem('betogo_token')
    useWalletStore.getState().reset()
    const promotion = usePromotionStore.getState()
    usePromotionStore.setState({
      highlights: [],
      redPacketRecords: [],
      redPacketSheet: { open: false, amountPhp: 0, title: '' },
    })
    // keep other promo state as-is
    void promotion
  },
}))
