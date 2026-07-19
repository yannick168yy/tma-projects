import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Phone, Lock, Eye, EyeOff, Check, ArrowLeft } from 'lucide-react'
import { createPortal } from 'react-dom'
import BetogoLogo from '@/components/BetogoLogo'
import { resetForgotPassword, sendForgotPasswordOtp } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { clearLastLogin, getLastLogin, isRememberMeEnabled, setRememberMeEnabled } from '@/utils/lastLogin'
import { getStoredReferral } from '@/utils/referral'
import { translateApiError } from '@/utils/translateApiError'
import { TURNSTILE_SITE_KEY, loadTurnstile } from '@/utils/turnstile'

interface Props {
  open: boolean
  onClose: () => void
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.46-2.27 2.18c-.25.25-.46.46-.95.46l.34-4.78 8.7-7.86c.38-.34-.08-.53-.59-.19L6.7 13.1l-4.64-1.45c-1.01-.32-1.03-1.01.21-1.5L20.62 2.9c.84-.31 1.58.2 1.32 1.4Z" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M22.5 12.2c0-.7-.06-1.4-.18-2.06H12v3.9h5.9a5.04 5.04 0 0 1-2.19 3.3v2.74h3.54c2.07-1.9 3.25-4.71 3.25-7.88Z" />
      <path fill="#34A853" d="M12 23c2.95 0 5.43-.98 7.24-2.65l-3.54-2.74c-.98.66-2.24 1.05-3.7 1.05-2.85 0-5.26-1.92-6.12-4.5H2.23v2.83A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.88 14.16a6.6 6.6 0 0 1 0-4.32V7.01H2.23a11 11 0 0 0 0 9.98l3.65-2.83Z" />
      <path fill="#EA4335" d="M12 5.5c1.6 0 3.05.55 4.19 1.64l3.13-3.13C17.43 2.18 14.95 1 12 1A11 11 0 0 0 2.23 7.01l3.65 2.83C6.74 7.42 9.15 5.5 12 5.5Z" />
    </svg>
  )
}

export default function LoginSheet({ open, onClose }: Props) {
  const { t } = useTranslation()
  const isTelegram = useAuthStore((s) => s.isTelegram)
  const loginReason = useAuthStore((s) => s.loginReason)
  const loginWithTelegram = useAuthStore((s) => s.loginWithTelegram)
  const loginWithTelegramOidc = useAuthStore((s) => s.loginWithTelegramOidc)
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle)
  const loginOrRegisterWithPassword = useAuthStore((s) => s.loginOrRegisterWithPassword)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [view, setView] = useState<'auth' | 'forgot'>('auth')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // Turnstile 只服务手机号/密码注册,Google/Telegram 登录不需要。iOS PWA standalone 下
  // 打开即注入 Cloudflare 跨域 iframe 会压垮 webview 渲染进程(白屏→闪退回首页),
  // 因此延到用户真正聚焦手机号/密码框时才加载。
  const [turnstileArmed, setTurnstileArmed] = useState(false)
  const [rememberMe, setRememberMe] = useState(() => isRememberMeEnabled())
  // 上次登录记忆：OAuth 显示快捷续登卡片，phone 预填手机号
  const initialLastLogin = useMemo(() => (open ? getLastLogin() : null), [open])
  const [lastLogin, setLastLogin] = useState(initialLastLogin)
  useEffect(() => {
    if (!open) return
    setTurnstileArmed(false)
    const last = getLastLogin()
    setLastLogin(last)
    if (last?.provider === 'phone' && last.identifier) setIdentifier(last.identifier)
  }, [open])
  const quickLogin = lastLogin && (lastLogin.provider === 'google' || lastLogin.provider === 'telegram') ? lastLogin : null
  const [resetPhone, setResetPhone] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const storedRef = getStoredReferral()

  // Turnstile 人机验证：配置了 site key 才渲染；token 随注册请求提交
  const turnstileRef = useRef<HTMLDivElement | null>(null)
  const turnstileWidgetRef = useRef<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>()
  useEffect(() => {
    if (!open || !TURNSTILE_SITE_KEY || view !== 'auth' || !turnstileArmed) return
    let cancelled = false
    void loadTurnstile()
      .then((ts) => {
        if (cancelled || !turnstileRef.current || turnstileWidgetRef.current) return
        turnstileWidgetRef.current = ts.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          callback: (token) => setTurnstileToken(token),
          'expired-callback': () => setTurnstileToken(undefined),
          'error-callback': () => setTurnstileToken(undefined),
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      // 弹层关闭即卸载 portal DOM，widget 一并销毁，下次打开重新渲染
      if (turnstileWidgetRef.current) {
        window.turnstile?.remove(turnstileWidgetRef.current)
        turnstileWidgetRef.current = null
        setTurnstileToken(undefined)
      }
    }
  }, [open, view, turnstileArmed])

  // 从 OAuth 整页跳转返回(尤其 iOS Safari 的 bfcache 恢复)时,JS 堆被原样还原,
  // loading 会残留为 true,导致 Telegram/Google 按钮持续置灰。页面重新可见即复位。
  useEffect(() => {
    const reset = () => setLoading(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  function normalizePhoneInput(value: string): string {
    const cleaned = value.replace(/[^\d+]/g, '')
    if (!cleaned || cleaned.startsWith('0') || cleaned.startsWith('+') || cleaned.startsWith('63')) return cleaned
    return `0${cleaned}`
  }

  function onIdentifierChange(value: string) {
    setIdentifier(normalizePhoneInput(value))
  }

  function onQuickLogin() {
    if (!quickLogin) return
    if (quickLogin.provider === 'google') onGoogleLogin()
    else if (isTelegram) void onTelegramLogin()
    else onTelegramOidcLogin()
  }

  function onUseAnotherAccount() {
    clearLastLogin()
    setLastLogin(null)
  }

  async function onTelegramLogin() {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await loginWithTelegram()
    } catch (e) {
      setError(e instanceof Error ? translateApiError(e.message, t) : t('auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  function onGoogleLogin() {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      loginWithGoogle()
    } catch (e) {
      setError(e instanceof Error ? translateApiError(e.message, t) : t('auth.loginFailed'))
      setLoading(false)
    }
  }

  function onTelegramOidcLogin() {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      loginWithTelegramOidc()
    } catch (e) {
      setError(e instanceof Error ? translateApiError(e.message, t) : t('auth.loginFailed'))
      setLoading(false)
    }
  }

  async function onPasswordSubmit() {
    if (!identifier.trim() || !password) {
      setError(t('auth.fillAll'))
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await loginOrRegisterWithPassword('phone', identifier.trim(), password, undefined, turnstileToken)
    } catch (e) {
      setError(e instanceof Error ? translateApiError(e.message, t) : t('auth.loginFailed'))
      // 验证码校验失败或已消费，重置 widget 换新 token
      if (e instanceof Error && e.message === 'errors.captchaFailed' && turnstileWidgetRef.current) {
        setTurnstileToken(undefined)
        window.turnstile?.reset(turnstileWidgetRef.current)
      }
    } finally {
      setLoading(false)
    }
  }

  async function onSendResetCode() {
    if (!resetPhone.trim()) {
      setError(t('auth.fillAll'))
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await sendForgotPasswordOtp(resetPhone.trim())
      setResetSent(true)
    } catch (e) {
      setError(e instanceof Error ? translateApiError(e.message, t) : t('auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function onResetPassword() {
    if (!resetPhone.trim() || !resetCode.trim() || !resetPassword) {
      setError(t('auth.fillAll'))
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await resetForgotPassword(resetPhone.trim(), resetCode.trim(), resetPassword)
      setPassword(resetPassword)
      setIdentifier(resetPhone)
      setView('auth')
      setResetSent(false)
      setResetCode('')
      setResetPassword('')
      setNotice(t('auth.passwordResetSuccess'))
    } catch (e) {
      setError(e instanceof Error ? translateApiError(e.message, t) : t('auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className="fixed bottom-0 left-1/2 z-[91] max-h-[90vh] w-full max-w-[430px] overflow-y-auto rounded-t-[1.8rem] bg-[#090d17] shadow-[0_-18px_70px_rgba(0,0,0,0.55)]"
        style={{ transform: 'translateX(-50%)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="relative flex justify-center pt-3 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-white/15" />
        </div>

        <button
          type="button"
          className="absolute right-4 top-4 z-10 rounded-full bg-white/8 p-2.5 text-[#a9b0c7] transition-colors hover:bg-white/12 hover:text-foreground"
          onClick={onClose}
        >
          <X size={20} />
        </button>

        <div className="relative px-5 pb-5 pt-6">
          <div className="mb-4 flex justify-center">
            <BetogoLogo />
          </div>
          <h2 className="text-center text-[24px] font-black leading-tight text-white">
            {view === 'forgot' ? t('auth.forgotTitle') : (
              <>
                {t('auth.welcomeTo')} <span className="text-primary">BetoGo</span>
              </>
            )}
          </h2>
          <p className="mx-auto mt-2 max-w-[17rem] text-center text-xs font-bold leading-relaxed text-[#9aa1b8]">
            {view === 'forgot' ? t('auth.forgotSubtitle') : loginReason ?? t('auth.signInSubtitle')}
          </p>

          {storedRef && view === 'auth' && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/8 px-3 py-2 text-center text-[11px] font-bold text-primary">
              {t('auth.invitedBanner')}
            </div>
          )}

          {quickLogin && view === 'auth' && (
            <div className="mt-5 rounded-[18px] border border-primary/25 bg-primary/5 p-4">
              <div className="flex items-center gap-3">
                {quickLogin.avatarUrl ? (
                  <img src={quickLogin.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${quickLogin.provider === 'google' ? 'bg-white' : 'bg-[#2AABEE] text-white'}`}>
                    {quickLogin.provider === 'google' ? <GoogleIcon /> : <TelegramIcon />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-white">
                    {t('auth.welcomeBackName', { name: quickLogin.displayName ?? '' })}
                  </p>
                  <p className="text-[11px] font-bold text-[#9aa1b8]">
                    {quickLogin.provider === 'google' ? 'Google' : 'Telegram'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="mt-3 w-full rounded-[14px] bg-gradient-to-b from-[#ffcc19] to-[#ffae00] py-3 text-sm font-black text-black shadow-[0_8px_24px_rgba(255,184,0,0.28)] transition-all active:scale-[0.98] disabled:opacity-60"
                disabled={loading}
                onClick={onQuickLogin}
              >
                {t('auth.continueWithProvider', { provider: quickLogin.provider === 'google' ? 'Google' : 'Telegram' })}
              </button>
              <button
                type="button"
                className="mt-2 w-full text-center text-xs font-bold text-[#9aa1b8] transition-colors hover:text-foreground"
                onClick={onUseAnotherAccount}
              >
                {t('auth.useAnotherAccount')}
              </button>
            </div>
          )}

          {view === 'auth' ? (
            <>
              <div className="mt-4 space-y-3">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9aa1c7]">
                    <Phone size={18} />
                  </span>
                  <input
                    value={identifier}
                    type="tel"
                    autoComplete="tel"
                    placeholder={t('auth.phonePlaceholder')}
                    className="w-full rounded-[14px] border border-white/12 bg-[#121824] py-3.5 pl-11 pr-4 text-sm font-bold text-foreground transition-colors placeholder:text-[#798098] focus:border-primary focus:outline-none"
                    onChange={(e) => onIdentifierChange(e.target.value)}
                    onFocus={() => setTurnstileArmed(true)}
                  />
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9aa1c7]">
                    <Lock size={18} />
                  </span>
                  <input
                    value={password}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder={t('auth.passwordPlaceholder')}
                    className="w-full rounded-[14px] border border-white/12 bg-[#121824] py-3.5 pl-11 pr-11 text-sm font-bold text-foreground transition-colors placeholder:text-[#798098] focus:border-primary focus:outline-none"
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void onPasswordSubmit() }}
                    onFocus={() => setTurnstileArmed(true)}
                  />
                  <button
                    type="button"
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9aa1c7] hover:text-foreground"
                    onClick={() => setShowPassword((p) => !p)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-xs font-bold text-[#bcc3d7]"
                    onClick={() => { const next = !rememberMe; setRememberMe(next); setRememberMeEnabled(next) }}
                  >
                    <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border ${rememberMe ? 'border-primary bg-primary text-black' : 'border-white/20 bg-transparent text-transparent'}`}>
                      <Check size={12} strokeWidth={3} />
                    </span>
                    {t('auth.rememberMe')}
                  </button>
                  <button
                    type="button"
                    className="text-xs font-black text-primary"
                    onClick={() => { setView('forgot'); setError(null); setNotice(null); setResetPhone(identifier) }}
                  >
                    {t('auth.forgotPassword')}
                  </button>
                </div>
                {TURNSTILE_SITE_KEY && turnstileArmed && <div ref={turnstileRef} className="flex justify-center" />}
                <button
                  type="button"
                  className="w-full rounded-[14px] bg-gradient-to-b from-[#ffcc19] to-[#ffae00] py-3.5 text-sm font-black text-black shadow-[0_8px_24px_rgba(255,184,0,0.28)] transition-all active:scale-[0.98] disabled:opacity-60"
                  disabled={loading}
                  onClick={() => void onPasswordSubmit()}
                >
                  {t('auth.continueButton')}
                </button>
              </div>
            </>
          ) : (
            <div className="mt-5 space-y-3">
              <button
                type="button"
                className="flex items-center gap-2 text-xs font-black text-[#bcc3d7]"
                onClick={() => { setView('auth'); setError(null); setNotice(null) }}
              >
                <ArrowLeft size={16} />
                {t('auth.backToLogin')}
              </button>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9aa1c7]">
                  <Phone size={18} />
                </span>
                <input
                  value={resetPhone}
                  type="tel"
                  autoComplete="tel"
                  placeholder={t('auth.phonePlaceholder')}
                  className="w-full rounded-[14px] border border-white/12 bg-[#121824] py-3.5 pl-11 pr-4 text-sm font-bold text-foreground transition-colors placeholder:text-[#798098] focus:border-primary focus:outline-none"
                  onChange={(e) => setResetPhone(normalizePhoneInput(e.target.value))}
                />
              </div>
              {resetSent && (
                <>
                  <input
                    value={resetCode}
                    type="text"
                    inputMode="numeric"
                    placeholder={t('auth.otpPlaceholder')}
                    className="w-full rounded-[14px] border border-white/12 bg-[#121824] px-4 py-3.5 text-sm font-bold text-foreground transition-colors placeholder:text-[#798098] focus:border-primary focus:outline-none"
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  <input
                    value={resetPassword}
                    type="password"
                    autoComplete="new-password"
                    placeholder={t('auth.newPasswordPlaceholder')}
                    className="w-full rounded-[14px] border border-white/12 bg-[#121824] px-4 py-3.5 text-sm font-bold text-foreground transition-colors placeholder:text-[#798098] focus:border-primary focus:outline-none"
                    onChange={(e) => setResetPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void onResetPassword() }}
                  />
                </>
              )}
              <button
                type="button"
                className="w-full rounded-[14px] bg-gradient-to-b from-[#ffcc19] to-[#ffae00] py-3.5 text-sm font-black text-black shadow-[0_8px_24px_rgba(255,184,0,0.28)] transition-all active:scale-[0.98] disabled:opacity-60"
                disabled={loading}
                onClick={() => resetSent ? void onResetPassword() : void onSendResetCode()}
              >
                {resetSent ? t('auth.resetPasswordButton') : t('auth.sendCode')}
              </button>
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-500/10 py-2 text-center text-xs font-bold text-red-400">
              {error}
            </p>
          )}
          {notice && (
            <p className="mt-3 rounded-lg bg-emerald-500/10 py-2 text-center text-xs font-bold text-emerald-300">
              {notice}
            </p>
          )}

          {view === 'auth' && (
            <>
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] font-black uppercase text-[#8f96ad]">{t('auth.or')}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <p className="mb-3 text-center text-xs font-bold text-[#9aa1b8]">{t('auth.continueWith')}</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="flex min-w-0 items-center justify-center gap-2 rounded-[14px] border border-white/12 bg-[#121824] px-2 py-2.5 text-xs font-black text-white transition-all active:scale-[0.98] disabled:opacity-60"
                  disabled={loading}
                  onClick={() => (isTelegram ? void onTelegramLogin() : onTelegramOidcLogin())}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2AABEE] text-white">
                    <TelegramIcon />
                  </span>
                  <span className="truncate">Telegram</span>
                </button>
                <button
                  type="button"
                  className="flex min-w-0 items-center justify-center gap-2 rounded-[14px] border border-white/12 bg-[#121824] px-2 py-2.5 text-xs font-black text-white transition-all active:scale-[0.98] disabled:opacity-60"
                  disabled={loading}
                  onClick={onGoogleLogin}
                >
                  <GoogleIcon />
                  <span className="truncate">Google</span>
                </button>
              </div>
              <p className="mx-auto mt-4 max-w-[17rem] text-center text-[11px] font-bold leading-relaxed text-[#8f96ad]">
                {t('auth.termsPrefix')} <span className="text-primary">{t('home.infoTerms')}</span> {t('auth.termsAnd')} <span className="text-primary">{t('home.infoPrivacy')}</span>
              </p>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
