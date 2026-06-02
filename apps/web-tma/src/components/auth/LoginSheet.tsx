import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import BetogoLogo from '@/components/BetogoLogo'
import { useAuthStore } from '@/stores/auth'

interface Props {
  open: boolean
  onClose: () => void
}

export default function LoginSheet({ open, onClose }: Props) {
  const { t } = useTranslation()
  const { loginWithTelegram, loginWithGoogle } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    loginWithGoogle()
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="relative z-10 w-full max-w-[430px] rounded-t-3xl border border-border bg-card p-6 shadow-2xl sm:rounded-3xl"
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

        <h2 className="mb-1 text-center text-xl font-black text-foreground">{t('auth.signIn')}</h2>
        <p className="mb-6 text-center text-sm text-muted-foreground">{t('auth.signInSub')}</p>

        {error && <p className="mb-3 text-center text-xs font-bold text-red-400">{error}</p>}

        <button
          type="button"
          className="mb-3 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#2AABEE] py-3.5 text-sm font-black text-white shadow-lg shadow-blue-500/20 disabled:opacity-60"
          disabled={loading}
          onClick={onTelegramLogin}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
            <path fill="#fff" d="M9.04 12.29 8.9 16.8c.47 0 .68-.2.93-.45l2.24-2.15 4.65 3.42c.85.47 1.46.22 1.67-.78l3.05-14.3c.31-1.44-.52-2.01-1.32-1.66L3.2 9.78c-1.4.55-1.38 1.33-.25 1.68l4.86 1.52 11.28-7.11c.53-.33 1.02-.15.62.18" />
          </svg>
          {loading ? t('auth.signingIn') : t('auth.continueWithTelegram')}
        </button>

        <button
          type="button"
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-white py-3.5 text-sm font-black text-gray-800"
          onClick={onGoogleLogin}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {t('auth.continueWithGoogle')}
        </button>

        <p className="mt-4 text-center text-[10px] text-muted-foreground">{t('auth.termsNotice')}</p>
      </div>
    </div>,
    document.body,
  )
}
