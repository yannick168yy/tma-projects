import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import BetogoLogo from '@/components/BetogoLogo'
import { bindGoogle, completeGoogleLogin } from '@/api/auth'
import { ApiError } from '@/api/client'
import { clearStoredOAuthState, extractRefFromOAuthState, getGoogleRedirectUri, isWellFormedOAuthState, readStoredOAuthState } from '@/utils/googleOAuth'
import { useAuthStore } from '@/stores/auth'
import { analytics } from '@/utils/analytics'

export default function GoogleAuthCallback() {
  const { t } = useTranslation()
  const applySession = useAuthStore((s) => s.applySession)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('error')
    const code = params.get('code')
    const state = params.get('state')

    if (oauthError) { setLoading(false); setError(`${t('auth.googleSignInFailed')} (${oauthError})`); return }
    if (!code) { setLoading(false); setError(t('auth.googleSignInFailed')); return }
    const storedState = readStoredOAuthState()
    // 有本地/cookie 记录时严格比对;两者都丢(iOS PWA 跳转期清空存储)时,退回校验
    // Google 回传的 state 是否为我们生成的合法结构,避免真实用户被硬卡在登录页。
    const stateOk = storedState ? state === storedState : !!state && isWellFormedOAuthState(state)
    if (!stateOk) {
      setLoading(false); clearStoredOAuthState(); setError(t('auth.stateInvalid')); return
    }

    // 绑定意图：已登录用户把 Google 挂到当前账号（而非登录/新建）
    if (sessionStorage.getItem('google_bind_intent')) {
      sessionStorage.removeItem('google_bind_intent')
      bindGoogle(code, getGoogleRedirectUri())
        .then(() => { clearStoredOAuthState(); window.location.replace('/?bound=google') })
        .catch((e) => { clearStoredOAuthState(); setError(e instanceof ApiError ? e.message : t('auth.bindFailed')); setLoading(false) })
      return
    }

    const referralCode = extractRefFromOAuthState(storedState ?? state ?? '')
    completeGoogleLogin(code, getGoogleRedirectUri(), referralCode || undefined)
      .then((session) => {
        applySession(session, 'google')
        analytics.loginSuccess(session.user.loginProvider ?? 'google', session.isNewUser, session.user.id)
        clearStoredOAuthState()
        window.location.replace('/')
      })
      .catch(() => {
        clearStoredOAuthState()
        setError(t('auth.googleSignInFailed'))
        setLoading(false)
      })
  }, [applySession, t])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <BetogoLogo />
      {loading && <Loader2 size={32} className="mt-6 animate-spin text-primary" />}
      {loading && <p className="mt-4 text-sm text-muted-foreground">{t('auth.signingInGoogle')}</p>}
      {error && !loading && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {error && !loading && (
        <button
          type="button"
          className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          onClick={() => window.location.replace('/')}
        >
          {t('auth.backHome')}
        </button>
      )}
    </div>
  )
}
