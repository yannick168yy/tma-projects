import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { X, Check, Loader2 } from 'lucide-react'
import { ApiError } from '@/api/client'
import { bindAccount, bindPhone } from '@/api/auth'
import { startGoogleLoginRedirect } from '@/utils/googleOAuth'
import { startTelegramLoginRedirect } from '@/utils/telegramOAuth'
import { useAuthStore } from '@/stores/auth'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'
import type { AuthUser } from '@/types/api'
import iconTelegram from '@/assets/menu/icons/22_telegram.webp'
import iconGoogle from '@/assets/menu/icons/06_google.webp'
import iconPhone from '@/assets/menu/icons/01_Phone.webp'
import iconAccount from '@/assets/menu/icons/02_Username_password.webp'

interface Props {
  open: boolean
  onClose: () => void
}

function maskSegment(value: string): string {
  if (value.length <= 2) return '*'.repeat(value.length)
  if (value.length <= 4) return `${value[0]}${'*'.repeat(value.length - 1)}`
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(4, value.length - 4))}${value.slice(-2)}`
}

function maskAccountName(value?: string | number): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const prefix = text.startsWith('@') ? '@' : ''
  const source = prefix ? text.slice(1) : text
  const emailAt = source.indexOf('@')
  if (emailAt > 0) {
    return `${maskSegment(source.slice(0, emailAt))}@${source.slice(emailAt + 1)}`
  }
  return `${prefix}${maskSegment(source)}`
}

export default function BindModal({ open, onClose }: Props) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expand, setExpand] = useState<'phone' | 'account' | null>(null)
  const [phone, setPhone] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function applyBound(u: AuthUser) {
    useAuthStore.setState((s) => ({ ...s, user: { ...s.user!, ...u } }))
    setExpand(null); setPhone(''); setUsername(''); setPassword('')
  }

  async function run(fn: () => Promise<{ user: AuthUser }>) {
    setLoading(true); setError(null)
    try {
      const res = await fn()
      applyBound(res.user)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('bind.failed'))
    } finally { setLoading(false) }
  }

  function onBindGoogle() {
    sessionStorage.setItem('google_bind_intent', '1')
    startGoogleLoginRedirect()
  }

  function onBindTelegram() {
    sessionStorage.setItem('telegram_bind_intent', '1')
    startTelegramLoginRedirect()
  }

  if (!open || !user) return null

  const inputCls = 'w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground focus:border-primary focus:outline-none'
  const rowCls = 'flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary px-4 py-3'
  const boundStatus = (label?: string | number) => {
    const masked = maskAccountName(label)
    return (
      <span className="flex min-w-0 max-w-[160px] flex-col items-end">
        <span className="flex items-center gap-1 text-xs font-bold text-emerald-400"><Check size={14} />{t('bind.bound')}</span>
        {masked && <span className="w-full truncate text-right text-[11px] font-bold text-muted-foreground">{masked}</span>}
      </span>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 max-h-[92vh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl border border-border bg-card p-6 shadow-2xl sm:rounded-3xl">
        <button type="button" className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:text-foreground" onClick={onClose}><X size={18} /></button>
        <h2 className="text-lg font-black text-foreground">{t('bind.title')}</h2>
        <p className="mb-5 mt-1 text-xs text-muted-foreground">{t('bind.subtitle')}</p>

        <div className="space-y-3">
          {/* Telegram */}
          <div className={rowCls}>
            <span className="flex items-center gap-2.5">
              <img src={iconTelegram} alt="" className="h-6 w-6 object-contain" />
              <span className="text-sm font-bold text-foreground">Telegram</span>
            </span>
            {user.boundTelegram ? boundStatus(user.telegramUsername ?? user.telegramUserId) : isInsideTelegram()
              ? <span className="text-[11px] text-muted-foreground">{t('bind.telegramBrowserOnly')}</span>
              : <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground" onClick={onBindTelegram}>{t('bind.action')}</button>}
          </div>

          {/* Google */}
          <div className={rowCls}>
            <span className="flex items-center gap-2.5">
              <img src={iconGoogle} alt="" className="h-6 w-6 object-contain" />
              <span className="text-sm font-bold text-foreground">Google</span>
            </span>
            {user.boundGoogle ? boundStatus(user.email) : (
              <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground" onClick={onBindGoogle}>{t('bind.action')}</button>
            )}
          </div>

          {/* Phone */}
          <div>
            <div className={rowCls}>
              <span className="flex items-center gap-2.5">
                <img src={iconPhone} alt="" className="h-6 w-6 object-contain" />
                <span className="text-sm font-bold text-foreground">{t('bind.phone')}</span>
              </span>
              {user.boundPhone ? boundStatus(user.phone) : (
                <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground" onClick={() => setExpand(expand === 'phone' ? null : 'phone')}>{t('bind.action')}</button>
              )}
            </div>
            {expand === 'phone' && !user.boundPhone && (
              <div className="mt-2 space-y-2">
                <input value={phone} type="tel" placeholder={t('auth.phonePlaceholder')} className={inputCls} onChange={(e) => setPhone(e.target.value)} />
                <button type="button" className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50" disabled={loading} onClick={() => void run(() => bindPhone(phone.trim()))}>{loading ? <Loader2 size={15} className="mx-auto animate-spin" /> : t('bind.confirm')}</button>
              </div>
            )}
          </div>

          {/* Account */}
          <div>
            <div className={rowCls}>
              <span className="flex items-center gap-2.5">
                <img src={iconAccount} alt="" className="h-6 w-6 object-contain" />
                <span className="text-sm font-bold text-foreground">{t('bind.account')}</span>
              </span>
              {user.boundAccount ? boundStatus(user.username) : (
                <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground" onClick={() => setExpand(expand === 'account' ? null : 'account')}>{t('bind.action')}</button>
              )}
            </div>
            {expand === 'account' && !user.boundAccount && (
              <div className="mt-2 space-y-2">
                <input value={username} type="text" placeholder={t('auth.usernamePlaceholder')} className={inputCls} onChange={(e) => setUsername(e.target.value)} />
                <input value={password} type="password" placeholder={t('auth.passwordPlaceholder')} className={inputCls} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50" disabled={loading} onClick={() => void run(() => bindAccount(username.trim(), password))}>{loading ? <Loader2 size={15} className="mx-auto animate-spin" /> : t('bind.confirm')}</button>
              </div>
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>,
    document.body,
  )
}
