import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, User, Phone, Lock, Eye, EyeOff } from 'lucide-react'
import { createPortal } from 'react-dom'
import BetogoLogo from '@/components/BetogoLogo'
import { useAuthStore } from '@/stores/auth'
import type { PasswordMethod } from '@/types/api'

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
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword)
  const registerWithPassword = useAuthStore((s) => s.registerWithPassword)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [method, setMethod] = useState<PasswordMethod>('account')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  async function onTelegramLogin() {
    setLoading(true)
    setError(null)
    try {
      await loginWithTelegram()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  function onGoogleLogin() {
    setLoading(true)
    setError(null)
    try {
      loginWithGoogle()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.loginFailed'))
      setLoading(false)
    }
  }

  function onTelegramOidcLogin() {
    setLoading(true)
    setError(null)
    try {
      loginWithTelegramOidc()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.loginFailed'))
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
    try {
      if (mode === 'login') await loginWithPassword(method, identifier.trim(), password)
      else await registerWithPassword(method, identifier.trim(), password)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative z-10 max-h-[94vh] w-full max-w-[430px] overflow-y-auto rounded-t-[28px] border border-primary/20 bg-card shadow-[0_-8px_60px_rgba(0,0,0,0.6)] sm:rounded-[28px]"
        role="dialog"
        aria-modal="true"
      >
        {/* 顶部金色光晕装饰 */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40"
          style={{
            background:
              'radial-gradient(120% 80% at 50% 0%, rgba(255,184,0,0.18) 0%, rgba(255,184,0,0.04) 40%, transparent 70%)',
          }}
        />
        {/* 抓手条（移动端底部弹层质感） */}
        <div className="relative flex justify-center pt-3 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-white/15" />
        </div>

        <button
          type="button"
          className="absolute right-4 top-4 z-10 rounded-full bg-white/5 p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          onClick={onClose}
        >
          <X size={18} />
        </button>

        <div className="relative px-6 pb-7 pt-5">
          <div className="mb-4 flex justify-center">
            <BetogoLogo />
          </div>
          <h2 className="text-center text-[22px] font-black leading-tight">
            <span className="bg-gradient-to-r from-primary to-[#ffd86b] bg-clip-text text-transparent">
              {t('auth.signInTitle')}
            </span>
          </h2>
          <p className="mx-auto mt-1.5 max-w-[18rem] text-center text-xs leading-relaxed text-muted-foreground">
            {loginReason ?? t('auth.signInSubtitle')}
          </p>

          {/* 登录 / 注册 顶部切换 */}
          <div className="relative mt-6 grid grid-cols-2 rounded-2xl bg-secondary/70 p-1">
            <span
              className="absolute inset-y-1 w-[calc(50%-4px)] rounded-xl bg-gradient-to-b from-primary to-[#e6a600] shadow-[0_4px_14px_rgba(255,184,0,0.35)] transition-transform duration-300 ease-out"
              style={{ transform: mode === 'login' ? 'translateX(4px)' : 'translateX(calc(100% + 4px))' }}
            />
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`relative z-10 rounded-xl py-2.5 text-sm font-black transition-colors ${mode === m ? 'text-primary-foreground' : 'text-muted-foreground'}`}
                onClick={() => { setMode(m); setError(null) }}
              >
                {m === 'login' ? t('auth.loginButton') : t('auth.registerButton')}
              </button>
            ))}
          </div>

          {/* 账号 / 手机号 切换 */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(['account', 'phone'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-bold transition-all ${
                  method === m
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-secondary/50 text-muted-foreground'
                }`}
                onClick={() => { setMethod(m); setError(null) }}
              >
                {m === 'account' ? <User size={14} /> : <Phone size={14} />}
                {m === 'account' ? t('auth.tabAccount') : t('auth.tabPhone')}
              </button>
            ))}
          </div>

          {/* 输入区 */}
          <div className="mt-3 space-y-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                {method === 'phone' ? <Phone size={16} /> : <User size={16} />}
              </span>
              <input
                value={identifier}
                type={method === 'phone' ? 'tel' : 'text'}
                autoComplete={method === 'phone' ? 'tel' : 'username'}
                placeholder={method === 'phone' ? t('auth.phonePlaceholder') : t('auth.usernamePlaceholder')}
                className="w-full rounded-xl border border-border bg-secondary/60 py-3 pl-10 pr-4 text-sm font-bold text-foreground transition-colors focus:border-primary focus:bg-secondary focus:outline-none"
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                <Lock size={16} />
              </span>
              <input
                value={password}
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={t('auth.passwordPlaceholder')}
                className="w-full rounded-xl border border-border bg-secondary/60 py-3 pl-10 pr-11 text-sm font-bold text-foreground transition-colors focus:border-primary focus:bg-secondary focus:outline-none"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void onPasswordSubmit() }}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((p) => !p)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button
              type="button"
              className="w-full rounded-xl bg-gradient-to-b from-primary to-[#e6a600] py-3.5 text-sm font-black text-primary-foreground shadow-[0_6px_20px_rgba(255,184,0,0.3)] transition-all active:scale-[0.98] disabled:opacity-60"
              disabled={loading}
              onClick={() => void onPasswordSubmit()}
            >
              {mode === 'login' ? t('auth.loginButton') : t('auth.registerButton')}
            </button>
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-red-500/10 py-2 text-center text-xs font-bold text-red-400">
              {error}
            </p>
          )}

          {/* 分割线 */}
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t('auth.or')}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* 第三方 / Telegram 登录 */}
          <div className="space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2AABEE] py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(42,171,238,0.3)] transition-all active:scale-[0.98] disabled:opacity-60"
              disabled={loading}
              onClick={() => (isTelegram ? void onTelegramLogin() : onTelegramOidcLogin())}
            >
              <TelegramIcon />
              {isTelegram ? t('auth.retryTelegram') : t('auth.continueTelegram')}
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-secondary/60 py-3 text-sm font-bold text-foreground transition-all hover:bg-secondary active:scale-[0.98] disabled:opacity-60"
              disabled={loading}
              onClick={onGoogleLogin}
            >
              <GoogleIcon />
              {t('auth.continueGoogle')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
