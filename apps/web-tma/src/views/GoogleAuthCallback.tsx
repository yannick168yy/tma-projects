import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import SiteLogo from '@/components/SiteLogo'
import { bindGoogle, completeGoogleLogin } from '@/api/auth'
import { ApiError } from '@/api/client'
import { clearStoredOAuthState, extractRefFromOAuthState, getGoogleRedirectUri, isWellFormedOAuthState, parseOAuthState, readStoredOAuthState } from '@/utils/googleOAuth'
import { getSiteMarket } from '@/config/market'
import { useAuthStore } from '@/stores/auth'
import { analytics } from '@/utils/analytics'

/**
 * 借道注册域名登录后要跳回原线路域名。目标来自 Google 原样带回的 state，
 * 是攻击者可构造的，所以必须比对服务端签名下发的线路表，否则就是个开放重定向。
 */
async function safeReturnOrigin(origin: string | undefined): Promise<string | null> {
  if (!origin) return null
  let url: URL
  try { url = new URL(origin) } catch { return null }
  if (url.protocol !== 'https:' || url.origin !== origin || url.origin === window.location.origin) return null
  try {
    const res = await fetch(`/api/v1/app/bootstrap?market=${getSiteMarket()}`, { cache: 'no-store' })
    const body = await res.json() as { data?: { domains?: Array<{ domain: string }> } }
    const allowed = (body.data?.domains ?? []).map((item) => item.domain)
    return allowed.includes(url.hostname.replace(/^www\./, '')) ? origin : null
  } catch {
    return null
  }
}

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

    const returned = parseOAuthState(state)
    // 借道登录时会话 token 已写进原生 SessionVault，跳回线路域名后 initNativeToken 能读出来
    const goHome = (suffix = '') => {
      void safeReturnOrigin(returned?.origin).then((origin) => {
        window.location.replace(`${origin ?? ''}/${suffix}`)
      })
    }

    // 绑定意图：已登录用户把 Google 挂到当前账号（而非登录/新建）
    if (sessionStorage.getItem('google_bind_intent') || returned?.intent === 'bind') {
      sessionStorage.removeItem('google_bind_intent')
      bindGoogle(code, getGoogleRedirectUri())
        .then(() => { clearStoredOAuthState(); goHome('?bound=google') })
        .catch((e) => { clearStoredOAuthState(); setError(e instanceof ApiError ? e.message : t('auth.bindFailed')); setLoading(false) })
      return
    }

    const referralCode = extractRefFromOAuthState(storedState ?? state ?? '')
    completeGoogleLogin(code, getGoogleRedirectUri(), referralCode || undefined)
      .then((session) => {
        applySession(session, 'google')
        analytics.loginSuccess(session.user.loginProvider ?? 'google', session.isNewUser, session.user.id)
        clearStoredOAuthState()
        goHome()
      })
      .catch(() => {
        clearStoredOAuthState()
        setError(t('auth.googleSignInFailed'))
        setLoading(false)
      })
  }, [applySession, t])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <SiteLogo />
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
