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
  const isTelegram = useAuthStore((s) => s.isTelegram)
  const loginReason = useAuthStore((s) => s.loginReason)
  const loginWithTelegram = useAuthStore((s) => s.loginWithTelegram)
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle)
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
    setLoading(true)
    setError(null)
    try {
      loginWithGoogle()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.loginFailed'))
      setLoading(false)
    }
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
        <h2 className="text-center text-lg font-black text-foreground">{t('auth.signInTitle')}</h2>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {loginReason ?? t('auth.signInSubtitle')}
        </p>
        {isTelegram && (
          <p className="mt-2 text-center text-[10px] text-muted-foreground">{t('auth.telegramHint')}</p>
        )}

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
            <>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary py-3 text-sm font-bold text-foreground disabled:opacity-60"
                disabled={loading}
                onClick={onGoogleLogin}
              >
                <span className="text-base">G</span>
                {t('auth.continueGoogle')}
              </button>
              <p className="text-center text-[10px] text-muted-foreground">{t('auth.googleRedirectHint')}</p>
            </>
          )}
        </div>

        {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>,
    document.body,
  )
}
