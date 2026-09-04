import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import SiteLogo from '@/components/SiteLogo'
import { bindTelegramOidc, completeTelegramLogin } from '@/api/auth'
import { clearStoredOAuthState, getTelegramRedirectUri, readStoredNonce, readStoredRef } from '@/utils/telegramOAuth'
import { useAuthStore } from '@/stores/auth'
import { analytics } from '@/utils/analytics'

export default function TelegramAuthCallback() {
  const { t } = useTranslation()
  const applySession = useAuthStore((s) => s.applySession)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('error')
    const code = params.get('code')
    const state = params.get('state')

    if (oauthError) { setLoading(false); setError(`${t('auth.loginFailed')} (${oauthError})`); return }
    if (!code) { setLoading(false); setError(t('auth.missingCode')); return }

    // 仅当本地存了 nonce 且与回跳 state 明确不一致时才拒绝；
    // Telegram 授权要跳到 App 再跳回，state 可能缺失/被改写，此时不阻断登录
    // （后端已校验 redirect_uri 并用 client_secret 换 token，安全由后端兜底）
    const storedNonce = readStoredNonce()
    if (storedNonce && state && state !== storedNonce) {
      setLoading(false); clearStoredOAuthState(); setError(t('auth.stateInvalid')); return
    }

    // 绑定意图：已登录用户把 Telegram 挂到当前账号（而非登录/新建）
    if (sessionStorage.getItem('telegram_bind_intent')) {
      sessionStorage.removeItem('telegram_bind_intent')
      bindTelegramOidc(code, getTelegramRedirectUri())
        .then(() => { clearStoredOAuthState(); window.location.replace('/?bound=telegram') })
        .catch((e) => { clearStoredOAuthState(); setError(e instanceof Error ? e.message : t('auth.loginFailed')); setLoading(false) })
      return
    }

    const referralCode = readStoredRef()
    completeTelegramLogin(code, getTelegramRedirectUri(), referralCode || undefined)
      .then((session) => {
        applySession(session, 'telegram')
        analytics.loginSuccess(session.user.loginProvider ?? 'telegram_oidc', session.isNewUser, session.user.id)
        clearStoredOAuthState()
        window.location.replace('/')
      })
      .catch((e) => {
        clearStoredOAuthState()
        setError(e instanceof Error ? e.message : t('auth.loginFailed'))
        setLoading(false)
      })
  }, [applySession, t])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <SiteLogo />
      {loading && <Loader2 size={32} className="mt-6 animate-spin text-primary" />}
      {loading && <p className="mt-4 text-sm text-muted-foreground">{t('auth.signingInTelegram')}</p>}
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
