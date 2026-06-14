import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import BetogoLogo from '@/components/BetogoLogo'
import { completeTelegramLogin } from '@/api/auth'
import { clearStoredOAuthState, extractRefFromOAuthState, getTelegramRedirectUri, readStoredOAuthState } from '@/utils/telegramOAuth'
import { useAuthStore } from '@/stores/auth'

export default function TelegramAuthCallback() {
  const applySession = useAuthStore((s) => s.applySession)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('error')
    const code = params.get('code')
    const state = params.get('state')

    if (oauthError) { setLoading(false); setError(`Telegram 登录失败 (${oauthError})。`); return }
    if (!code) { setLoading(false); setError('缺少 Telegram 授权码。'); return }
    const storedState = readStoredOAuthState()
    if (state !== storedState) {
      setLoading(false); clearStoredOAuthState(); setError('登录状态校验失败，请重新登录。'); return
    }

    const referralCode = storedState ? extractRefFromOAuthState(storedState) : ''
    completeTelegramLogin(code, getTelegramRedirectUri(), referralCode || undefined)
      .then((session) => {
        applySession(session)
        clearStoredOAuthState()
        window.location.replace('/')
      })
      .catch((e) => {
        clearStoredOAuthState()
        setError(e instanceof Error ? e.message : 'Telegram 登录失败')
        setLoading(false)
      })
  }, [applySession])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <BetogoLogo />
      {loading && <Loader2 size={32} className="mt-6 animate-spin text-primary" />}
      {loading && <p className="mt-4 text-sm text-muted-foreground">正在用 Telegram 登录…</p>}
      {error && !loading && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {error && !loading && (
        <button
          type="button"
          className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          onClick={() => window.location.replace('/')}
        >
          返回首页
        </button>
      )}
    </div>
  )
}
