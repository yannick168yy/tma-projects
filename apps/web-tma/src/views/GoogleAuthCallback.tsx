import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import BetogoLogo from '@/components/BetogoLogo'
import { bindGoogle, completeGoogleLogin } from '@/api/auth'
import { clearStoredOAuthState, extractRefFromOAuthState, getGoogleRedirectUri, readStoredOAuthState } from '@/utils/googleOAuth'
import { useAuthStore } from '@/stores/auth'

export default function GoogleAuthCallback() {
  const applySession = useAuthStore((s) => s.applySession)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('error')
    const code = params.get('code')
    const state = params.get('state')

    if (oauthError) { setLoading(false); setError(`Google sign-in failed (${oauthError}).`); return }
    if (!code) { setLoading(false); setError('Missing authorization code from Google.'); return }
    const storedState = readStoredOAuthState()
    if (state !== storedState) {
      setLoading(false); clearStoredOAuthState(); setError('Invalid OAuth state. Please sign in again.'); return
    }

    // 绑定意图：已登录用户把 Google 挂到当前账号（而非登录/新建）
    if (sessionStorage.getItem('google_bind_intent')) {
      sessionStorage.removeItem('google_bind_intent')
      bindGoogle(code, getGoogleRedirectUri())
        .then(() => { clearStoredOAuthState(); window.location.replace('/?bound=google') })
        .catch((e) => { clearStoredOAuthState(); setError(e instanceof Error ? e.message : 'Google 绑定失败'); setLoading(false) })
      return
    }

    const referralCode = storedState ? extractRefFromOAuthState(storedState) : ''
    completeGoogleLogin(code, getGoogleRedirectUri(), referralCode || undefined)
      .then((session) => {
        applySession(session)
        clearStoredOAuthState()
        window.location.replace('/')
      })
      .catch((e) => {
        clearStoredOAuthState()
        setError(e instanceof Error ? e.message : 'Google login failed')
        setLoading(false)
      })
  }, [applySession])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <BetogoLogo />
      {loading && <Loader2 size={32} className="mt-6 animate-spin text-primary" />}
      {loading && <p className="mt-4 text-sm text-muted-foreground">Signing you in with Google…</p>}
      {error && !loading && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {error && !loading && (
        <button
          type="button"
          className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          onClick={() => window.location.replace('/')}
        >
          Back to home
        </button>
      )}
    </div>
  )
}
