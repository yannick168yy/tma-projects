import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import BetogoLogo from '@/components/BetogoLogo'
import { useAuthStore } from '@/stores/auth'
import type { PasswordMethod } from '@/types/api'

interface Props {
  open: boolean
  onClose: () => void
}

export default function LoginSheet({ open, onClose }: Props) {
  const { t } = useTranslation()
  const isTelegram = useAuthStore((s) => s.isTelegram)
  const loginReason = useAuthStore((s) => s.loginReason)
  const loginWithTelegram = useAuthStore((s) => s.loginWithTelegram)
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle)
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword)
  const registerWithPassword = useAuthStore((s) => s.registerWithPassword)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [method, setMethod] = useState<PasswordMethod>('account')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

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
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="relative z-10 max-h-[92vh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl border border-border bg-card p-6 shadow-2xl sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X size={18} />
        </button>

        <div className="mb-5 flex justify-center">
          <BetogoLogo />
        </div>
        <h2 className="text-center text-lg font-black text-foreground">{t('auth.signInTitle')}</h2>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {loginReason ?? t('auth.signInSubtitle')}
        </p>

        {/* 第三方/Telegram 登录 */}
        <div className="mt-6 space-y-3">
          {isTelegram ? (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2AABEE] py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={loading}
              onClick={() => void onTelegramLogin()}
            >
              {t('auth.retryTelegram')}
            </button>
          ) : (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary py-3 text-sm font-bold text-foreground disabled:opacity-60"
              disabled={loading}
              onClick={onGoogleLogin}
            >
              <span className="text-base">G</span>
              {t('auth.continueGoogle')}
            </button>
          )}
        </div>

        {/* 分割线 */}
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('auth.or')}</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* 账号 / 手机号 切换 */}
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
          {(['account', 'phone'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`rounded-lg py-2 text-xs font-bold transition-colors ${method === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              onClick={() => { setMethod(m); setError(null) }}
            >
              {m === 'account' ? t('auth.tabAccount') : t('auth.tabPhone')}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <input
            value={identifier}
            type={method === 'phone' ? 'tel' : 'text'}
            autoComplete={method === 'phone' ? 'tel' : 'username'}
            placeholder={method === 'phone' ? t('auth.phonePlaceholder') : t('auth.usernamePlaceholder')}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground focus:border-primary focus:outline-none"
            onChange={(e) => setIdentifier(e.target.value)}
          />
          <input
            value={password}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={t('auth.passwordPlaceholder')}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground focus:border-primary focus:outline-none"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onPasswordSubmit() }}
          />
          <button
            type="button"
            className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
            disabled={loading}
            onClick={() => void onPasswordSubmit()}
          >
            {mode === 'login' ? t('auth.loginButton') : t('auth.registerButton')}
          </button>
          <button
            type="button"
            className="w-full text-center text-[11px] font-bold text-muted-foreground hover:text-foreground"
            onClick={() => { setMode((p) => (p === 'login' ? 'register' : 'login')); setError(null) }}
          >
            {mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}
          </button>
        </div>

        {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>,
    document.body,
  )
}
