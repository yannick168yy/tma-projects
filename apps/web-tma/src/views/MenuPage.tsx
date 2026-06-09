import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Copy, ChevronDown, ChevronRight, LogOut, Headphones, X, User } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { LANGUAGES } from '@/data/languages'
import type { LoginProvider } from '@/types/api'
import { formatTelegramHandle, getTelegramWebAppUser } from '@/utils/telegramUser'
import { patchProfile } from '@/api/auth'
import ContactBrandIcon from '@/components/profile/ContactBrandIcon'
import ContactMethodRow from '@/components/profile/ContactMethodRow'

interface Props {
  onOpenCs: () => void
  onLogin: () => void
  onLogout: () => void
  onOpenBetHistory: () => void
}

const CURRENCIES = [
  { symbol: '₱', name: 'PHP', color: 'from-blue-600 to-blue-800' },
  { symbol: '₮', name: 'USDT', color: 'from-teal-500 to-emerald-600' },
  { symbol: '💎', name: 'TON', color: 'from-sky-400 to-blue-600' },
  { symbol: '₿', name: 'BTC', color: 'from-orange-400 to-amber-600' },
  { symbol: 'Ξ', name: 'ETH', color: 'from-purple-500 to-indigo-700' },
  { symbol: '◈', name: 'BNB', color: 'from-yellow-400 to-yellow-600' },
]

const HOME_DOC_KEYS = new Set(['terms', 'privacy', 'responsible', 'about'])

export default function MenuPage({ onOpenCs, onLogin, onLogout, onOpenBetHistory }: Props) {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const { locale, setLocale } = useLocaleStore()
  const isLoggedIn = Boolean(auth.token && auth.user)

  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [personalSaved, setPersonalSaved] = useState(false)
  const [personalSaving, setPersonalSaving] = useState(false)
  const [personalError, setPersonalError] = useState('')
  const [copied, setCopied] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dobMonth, setDobMonth] = useState('')
  const [dobDay, setDobDay] = useState('')
  const [dobYear, setDobYear] = useState('')
  const [dobOpen, setDobOpen] = useState(false)
  const [gender, setGender] = useState('')
  const [phone, setPhone] = useState('')
  const [emailExtra, setEmailExtra] = useState('')
  const [comingSoonToast, setComingSoonToast] = useState(false)
  const [docModalKey, setDocModalKey] = useState<string | null>(null)
  const [langOpen, setLangOpen] = useState(false)
  const comingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const USER_ID = auth.user?.id ?? '—'
  const displayName = auth.user?.displayName ?? t('profile.playerAccount')
  const loginProvider: LoginProvider = auth.user?.loginProvider ?? (auth.user?.telegramUserId ? 'telegram' : 'google')
  const isTelegramLogin = loginProvider === 'telegram'
  const isGoogleLogin = loginProvider === 'google'
  const telegramHandle = formatTelegramHandle(auth.user?.telegramUsername) ?? formatTelegramHandle(getTelegramWebAppUser()?.username)
  const telegramSubtitle = isTelegramLogin ? (telegramHandle ?? t('profile.connected')) : t('profile.notConnected')
  const googleEmail = auth.user?.email?.trim() ?? ''
  const isGoogleEmailConnected = isGoogleLogin && Boolean(googleEmail)
  const emailRowTitle = isGoogleLogin ? t('profile.google') : t('profile.emailAddress')
  const emailRowSubtitle = isGoogleLogin ? (googleEmail || t('profile.notConnected')) : (emailExtra.trim() || t('profile.addEmailOptional'))
  const contactOrder: Array<'telegram' | 'email' | 'phone'> = loginProvider === 'google' ? ['email', 'telegram', 'phone'] : ['telegram', 'phone', 'email']

  const currentLang = LANGUAGES.find((l) => l.code === locale)!
  const MONTHS = Array.from({ length: 12 }, (_, i) => t(`profile.months.${i + 1}`))
  const genderOptions = [{ id: 'Male', label: t('profile.male') }, { id: 'Female', label: t('profile.female') }, { id: 'Other', label: t('profile.other') }]
  const years = Array.from({ length: new Date().getFullYear() - 1924 }, (_, i) => new Date().getFullYear() - 18 - i)
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
  const dobFilled = !!(dobMonth && dobDay && dobYear)
  const dobDisplay = dobFilled ? `${MONTHS[parseInt(dobMonth, 10) - 1]} ${parseInt(dobDay, 10)}, ${dobYear}` : ''

  const LINKS = [
    { icon: '📢', label: t('profile.links.channel'), sub: t('profile.links.channelSub'), color: 'from-blue-600 to-blue-800' },
    { icon: '💬', label: t('profile.links.community'), sub: t('profile.links.communitySub'), color: 'from-indigo-600 to-violet-700' },
    { icon: '🎰', label: t('profile.links.vip'), sub: t('profile.links.vipSub'), color: 'from-yellow-500 to-amber-600' },
    { icon: '📱', label: t('profile.links.facebook'), sub: t('profile.links.facebookSub'), color: 'from-blue-500 to-blue-700' },
  ]
  const SUPPORT_ITEMS = [
    { icon: '💬', label: t('profile.supportItems.liveChat'), sub: t('profile.supportItems.liveChatSub'), badge: t('common.online'), badgeColor: 'bg-emerald-500/20 text-emerald-400' },
    { icon: '📩', label: t('profile.supportItems.telegram'), sub: '@BetoGo_Support', badge: null, badgeColor: '' },
    { icon: '📧', label: t('profile.supportItems.email'), sub: 'support@betogo.com', badge: null, badgeColor: '' },
  ]
  const DOCS = [
    { key: 'terms', label: t('profile.docs.terms'), icon: '📋' },
    { key: 'privacy', label: t('profile.docs.privacy'), icon: '🔒' },
    { key: 'responsible', label: t('profile.docs.responsible'), icon: '🛡️' },
    { key: 'aml', label: t('profile.docs.aml'), icon: '⚖️' },
    { key: 'bonusTerms', label: t('profile.docs.bonusTerms'), icon: '🎁' },
    { key: 'about', label: t('profile.docs.about'), icon: 'ℹ️' },
  ]

  useEffect(() => {
    const p = auth.user?.profile
    if (p) { setFirstName(p.firstName ?? ''); setLastName(p.lastName ?? ''); setGender(p.gender ?? ''); setDobMonth(p.dobMonth ?? ''); setDobDay(p.dobDay ?? ''); setDobYear(p.dobYear ?? '') }
  }, [auth.user?.id])

  useEffect(() => {
    document.body.style.overflow = docModalKey ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [docModalKey])

  useEffect(() => () => { if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current) }, [])

  function showComingSoon() {
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current)
    setComingSoonToast(true)
    comingSoonTimer.current = setTimeout(() => setComingSoonToast(false), 2200)
  }

  function copyId() {
    if (!auth.user?.id) return
    navigator.clipboard?.writeText(auth.user.id).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  async function confirmLogout() {
    setLoggingOut(true)
    try { await auth.logout(); setLogoutConfirmOpen(false); onLogout() }
    finally { setLoggingOut(false) }
  }

  async function savePersonal() {
    if (!firstName || !lastName || !dobFilled || !gender) return
    setPersonalSaving(true); setPersonalError('')
    try {
      const saved = await patchProfile({ firstName, lastName, gender: gender as 'male' | 'female' | 'other' | '', dobMonth, dobDay, dobYear })
      if (auth.user) useAuthStore.setState((s) => ({ ...s, user: { ...s.user!, profile: saved } }))
      setPersonalSaved(true); setDobOpen(false)
    } catch (e) { setPersonalError(e instanceof Error ? e.message : '保存失败') }
    finally { setPersonalSaving(false) }
  }

  const docTitle = docModalKey ? t(`profile.docs.${docModalKey}`) : ''
  function parsedDocContent() {
    if (!docModalKey) return []
    const raw = HOME_DOC_KEYS.has(docModalKey) ? t(`home.infoDetails.${docModalKey}.content`) : t(`profile.docDetails.${docModalKey}.content`)
    const chunks = raw.split('\n\n').map((c) => c.trim()).filter(Boolean)
    const sections: { heading: string | null; body: string }[] = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const isHeading = chunk.length <= 60 && !chunk.includes('\n') && !/[.?!,。，！？]$/.test(chunk)
      if (isHeading && i + 1 < chunks.length) { sections.push({ heading: chunk, body: chunks[i + 1] }); i++ }
      else sections.push({ heading: null, body: chunk })
    }
    return sections
  }

  return (
    <div className="min-h-full pb-24">
      {/* Header */}
      {isLoggedIn ? (
        <div className="flex items-center gap-4 border-b border-border bg-card px-5 py-4">
          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">
            <svg viewBox="0 0 40 40" width="48" height="48" className="h-full w-full" aria-hidden="true">
              <ellipse cx="20" cy="26" rx="11" ry="9" fill="#92400e" /><ellipse cx="20" cy="19" rx="13" ry="13" fill="#a16207" /><ellipse cx="20" cy="20" rx="9" ry="9" fill="#b45309" />
              <circle cx="14" cy="17" r="6" fill="white" /><circle cx="26" cy="17" r="6" fill="white" />
              <circle cx="14" cy="17" r="4.2" fill="#1e293b" /><circle cx="26" cy="17" r="4.2" fill="#1e293b" />
              <circle cx="15.5" cy="15.5" r="1.4" fill="white" /><circle cx="27.5" cy="15.5" r="1.4" fill="white" />
              <ellipse cx="20" cy="22" rx="1.8" ry="1.2" fill="#7c2d12" />
              <ellipse cx="8" cy="12" rx="4" ry="5" fill="#92400e" /><ellipse cx="32" cy="12" rx="4" ry="5" fill="#92400e" />
              <ellipse cx="8" cy="12" rx="2.2" ry="3.2" fill="#b45309" /><ellipse cx="32" cy="12" rx="2.2" ry="3.2" fill="#b45309" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-sm font-black leading-none text-foreground">{displayName}</p>
            <button type="button" className="flex items-center gap-1.5 transition-opacity hover:opacity-80" onClick={copyId}>
              <span className="text-xs text-muted-foreground">ID: </span>
              <span className="text-xs font-bold text-primary">{USER_ID}</span>
              {copied ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} className="text-muted-foreground" />}
            </button>
            {copied && <p className="mt-0.5 text-[10px] font-semibold text-emerald-400">{t('common.copied')}</p>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 border-b border-border bg-card px-5 py-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-secondary">
            <User size={24} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-foreground">{t('shell.signIn')}</p>
            <p className="text-xs text-muted-foreground">{t('shell.tapToLogin')}</p>
          </div>
          <button
            type="button"
            className="rounded-full bg-primary px-4 py-2 text-sm font-black text-primary-foreground shadow shadow-amber-500/20 transition-colors hover:bg-yellow-400"
            onClick={onLogin}
          >
            {t('shell.signIn')}
          </button>
        </div>
      )}

      <div className="mt-4 space-y-4 px-5">
        {/* Personal Info — only when logged in */}
        {isLoggedIn && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-black text-foreground">{t('profile.personalInfo')}</h3>
              {personalSaved && <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400"><CheckCircle2 size={11} /> {t('common.verified')}</span>}
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('profile.firstName')}</label>
                <input value={firstName} type="text" placeholder={t('profile.firstNamePh')} readOnly={personalSaved} className="w-full bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none" onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="border-b border-border px-4 py-3">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('profile.lastName')}</label>
                <input value={lastName} type="text" placeholder={t('profile.lastNamePh')} readOnly={personalSaved} className="w-full bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none" onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="cursor-pointer border-b border-border px-4 py-3" onClick={() => !personalSaved && setDobOpen(!dobOpen)}>
                <label className="mb-1 block cursor-pointer text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('profile.dateOfBirth')}</label>
                {personalSaved ? <p className="text-sm font-semibold text-foreground">{dobDisplay || '—'}</p> : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-semibold ${dobFilled ? 'text-foreground' : 'text-muted-foreground/50'}`}>{dobFilled ? dobDisplay : t('profile.selectDob')}</span>
                      <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${dobOpen ? 'rotate-180' : ''}`} />
                    </div>
                    {dobOpen && (
                      <div className="mt-3 grid grid-cols-3 gap-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">{t('profile.month')}</span>
                          <select value={dobMonth} className="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none" onChange={(e) => setDobMonth(e.target.value)}>
                            <option value="">{t('profile.month')}</option>
                            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">{t('profile.day')}</span>
                          <select value={dobDay} className="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none" onChange={(e) => setDobDay(e.target.value)}>
                            <option value="">{t('profile.day')}</option>
                            {days.map((d) => <option key={d} value={d}>{parseInt(d, 10)}</option>)}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">{t('profile.year')}</span>
                          <select value={dobYear} className="appearance-none rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none" onChange={(e) => setDobYear(e.target.value)}>
                            <option value="">{t('profile.year')}</option>
                            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
                          </select>
                        </div>
                        {dobFilled && <button type="button" className="col-span-3 mt-1 rounded-lg bg-primary/20 py-1.5 text-xs font-black text-primary transition-colors hover:bg-primary/30" onClick={() => setDobOpen(false)}>{t('profile.confirmDob', { date: dobDisplay })}</button>}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="px-4 py-3">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('profile.gender')}</label>
                <div className="flex gap-2">
                  {genderOptions.map((g) => (
                    <button key={g.id} type="button" disabled={personalSaved} className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors ${gender === g.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'} ${personalSaved ? 'cursor-default opacity-60' : 'hover:text-foreground'}`} onClick={() => !personalSaved && setGender(g.id)}>{g.label}</button>
                  ))}
                </div>
              </div>
            </div>
            {personalError && <p className="mt-1 text-center text-xs font-bold text-red-400">{personalError}</p>}
            {!personalSaved && (
              <button type="button" className="mt-2.5 w-full rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground shadow shadow-amber-500/20 transition-colors hover:bg-yellow-400 disabled:opacity-50" disabled={personalSaving} onClick={() => void savePersonal()}>
                {personalSaving ? '保存中…' : t('profile.saveLock')}
              </button>
            )}
          </section>
        )}

        {/* Contact Info — only when logged in */}
        {isLoggedIn && (
          <section>
            <h3 className="mb-3 font-display text-sm font-black text-foreground">{t('profile.contactInfo')}</h3>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {contactOrder.map((block, idx) => (
                <div key={block} className={idx < contactOrder.length - 1 ? 'border-b border-border' : ''}>
                  {block === 'telegram' && (
                    <ContactMethodRow title={t('profile.telegram')} subtitle={telegramSubtitle} connected={isTelegramLogin} subtitleConnected={isTelegramLogin} icon={<ContactBrandIcon brand="telegram" />} />
                  )}
                  {block === 'email' && (
                    <ContactMethodRow title={emailRowTitle} subtitle={emailRowSubtitle} connected={isGoogleEmailConnected} subtitleConnected={isGoogleEmailConnected} icon={<ContactBrandIcon brand={isGoogleLogin ? 'google' : 'email'} />}
                      subtitleSlot={!isGoogleLogin ? <input value={emailExtra} type="email" placeholder="your@email.com" className="w-full bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none" onChange={(e) => setEmailExtra(e.target.value)} /> : undefined}
                    />
                  )}
                  {block === 'phone' && (
                    <ContactMethodRow title={t('profile.phoneNumber')} subtitle={t('profile.addPhoneOptional')} icon={<ContactBrandIcon brand="phone" />}
                      subtitleSlot={<div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">🇵🇭 +63</span><input value={phone} type="tel" placeholder="9XX XXX XXXX" className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none" onChange={(e) => setPhone(e.target.value)} /></div>}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Activity — only when logged in */}
        {isLoggedIn && (
          <section>
            <h3 className="mb-3 font-display text-sm font-black text-foreground">{t('profile.activity')}</h3>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <button type="button" className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-secondary/50" onClick={onOpenBetHistory}>
                <div className="flex items-center gap-3"><span className="text-base">🎰</span><span className="text-sm font-semibold text-foreground">{t('profile.betHistory')}</span></div>
                <ChevronRight size={14} className="text-muted-foreground" />
              </button>
            </div>
          </section>
        )}

        {/* Customer Support */}
        <section>
          <h3 className="mb-3 font-display text-sm font-black text-foreground">{t('profile.customerSupportSection')}</h3>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {SUPPORT_ITEMS.map((item, i) => (
              <button key={item.label} type="button" className={`flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-secondary/50 ${i < SUPPORT_ITEMS.length - 1 ? 'border-b border-border' : ''}`} onClick={() => i === 0 ? onOpenCs() : showComingSoon()}>
                <div className="flex items-center gap-3"><span className="text-xl">{item.icon}</span><div className="text-left"><p className="text-sm font-bold text-foreground">{item.label}</p><p className="text-xs text-muted-foreground">{item.sub}</p></div></div>
                <div className="flex items-center gap-2">{item.badge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.badgeColor}`}>{item.badge}</span>}<ChevronRight size={14} className="text-muted-foreground" /></div>
              </button>
            ))}
          </div>
        </section>

        {/* Community & Media */}
        <section>
          <h3 className="mb-3 font-display text-sm font-black text-foreground">{t('profile.communityMedia')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {LINKS.map((l) => (
              <button key={l.label} type="button" className={`relative rounded-2xl bg-gradient-to-br p-4 text-left transition-opacity hover:opacity-90 ${l.color}`} onClick={showComingSoon}>
                <span className="mb-2 block text-2xl">{l.icon}</span>
                <p className="text-xs font-black leading-tight text-white">{l.label}</p>
                <p className="mt-0.5 text-[10px] text-white/60">{l.sub}</p>
                <ChevronRight size={12} className="absolute right-3 top-3 text-white/50" />
              </button>
            ))}
          </div>
        </section>

        {/* Language */}
        <section>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" style={{ boxShadow: '0 0 6px #818cf8' }} />
            <h3 className="text-foreground font-black text-sm tracking-tight font-display">{t('menu.language')}</h3>
          </div>
          <button
            type="button"
            className="w-full flex items-center gap-3 py-3 px-3.5 rounded-2xl bg-white/4 border border-border text-left"
            onClick={() => setLangOpen(!langOpen)}
          >
            <span className="text-xl">{currentLang.flag}</span>
            <span className="flex-1 text-foreground font-bold text-sm">{t(`languages.${currentLang.code}`)}</span>
            <ChevronDown size={14} className={`text-muted-foreground transition-transform ${langOpen ? 'rotate-180' : ''}`} />
          </button>
          {langOpen && (
            <div className="mt-1.5 rounded-2xl overflow-hidden border border-border bg-card">
              {LANGUAGES.map((l, i) => (
                <button
                  key={l.code}
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary transition-colors ${i < LANGUAGES.length - 1 ? 'border-b border-border' : ''} ${locale === l.code ? 'bg-primary/8' : ''}`}
                  onClick={() => { setLocale(l.code as Parameters<typeof setLocale>[0]); setLangOpen(false) }}
                >
                  <span className="text-lg">{l.flag}</span>
                  <span className={`text-sm font-bold flex-1 ${locale === l.code ? 'text-primary' : 'text-foreground'}`}>{t(`languages.${l.code}`)}</span>
                  {locale === l.code && <CheckCircle2 size={13} className="text-primary" />}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Supported Currencies */}
        <section>
          <h3 className="mb-3 font-display text-sm font-black text-foreground">{t('profile.supportedCurrencies')}</h3>
          <div className="grid grid-cols-6 gap-2">
            {CURRENCIES.map((c) => (
              <div key={c.name} className="flex flex-col items-center gap-1">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-md ${c.color}`}><span className="text-sm font-black text-white">{c.symbol}</span></div>
                <span className="text-[10px] font-bold text-muted-foreground">{c.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Legal */}
        <section>
          <h3 className="mb-3 font-display text-sm font-black text-foreground">{t('profile.legalPolicies')}</h3>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {DOCS.map((d, i) => (
              <button key={d.key} type="button" className={`flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-secondary/50 ${i < DOCS.length - 1 ? 'border-b border-border' : ''}`} onClick={() => setDocModalKey(d.key)}>
                <div className="flex items-center gap-3"><span className="text-base">{d.icon}</span><span className="text-sm font-semibold text-foreground">{d.label}</span></div>
                <ChevronRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>

        {/* Account — only when logged in */}
        {isLoggedIn && (
          <section>
            <h3 className="mb-3 font-display text-sm font-black text-foreground">{t('profile.account')}</h3>
            <button type="button" className="flex w-full items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 py-3 text-sm font-black text-primary transition-colors hover:bg-primary/20 mb-3" onClick={onOpenCs}><Headphones size={16} />联系客服</button>
            <button type="button" className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 py-3 text-sm font-black text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-60" disabled={loggingOut} onClick={() => setLogoutConfirmOpen(true)}><LogOut size={16} />{t('profile.logout')}</button>
          </section>
        )}

        <div className="space-y-1 py-4 text-center">
          <p className="text-xs text-muted-foreground">{t('profile.footerVersion')}</p>
          <p className="text-xs text-muted-foreground">{t('profile.footerCopyright')}</p>
          <p className="mt-2 px-4 text-[10px] leading-relaxed text-muted-foreground">{t('profile.footerLegal')}</p>
        </div>
      </div>

      {comingSoonToast && createPortal(
        <div className="profile-toast fixed left-1/2 z-[200] flex max-w-[min(320px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3" role="status" aria-live="polite">
          <span className="profile-toast__icon text-lg leading-none">🚀</span>
          <div className="min-w-0"><p className="profile-toast__title text-sm font-black leading-tight">{t('profile.comingSoon')}</p><p className="mt-0.5 text-xs leading-snug text-foreground/75">{t('profile.comingSoonSub')}</p></div>
        </div>,
        document.getElementById('app') ?? document.body,
      )}

      {docModalKey && createPortal(
        <div className="fixed inset-0 z-[200] flex justify-center" role="dialog" aria-modal="true">
          <div className="relative flex h-full w-full max-w-[430px] flex-col justify-end">
            <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={() => setDocModalKey(null)} />
            <div className="relative z-10 flex max-h-[82vh] flex-col rounded-t-2xl bg-card shadow-2xl">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
                <h2 className="font-display text-base font-black text-foreground">{docTitle}</h2>
                <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary" onClick={() => setDocModalKey(null)}><X size={15} className="text-muted-foreground" /></button>
              </div>
              <div className="overflow-y-auto px-5 py-5 space-y-4">
                {parsedDocContent().map((s, i) => (
                  <div key={i}>
                    {s.heading && <p className="mb-1.5 border-l-2 border-primary pl-2.5 font-display text-[11px] font-black uppercase tracking-widest text-primary">{s.heading}</p>}
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/70">{s.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.getElementById('app') ?? document.body,
      )}

      {logoutConfirmOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h3 className="text-base font-black text-foreground">{t('profile.logoutConfirmTitle')}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t('profile.logoutConfirmBody2')}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" className="flex-1 rounded-xl bg-secondary py-2.5 text-sm font-bold text-foreground" disabled={loggingOut} onClick={() => setLogoutConfirmOpen(false)}>{t('profile.cancel')}</button>
              <button type="button" className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-black text-white disabled:opacity-60" disabled={loggingOut} onClick={() => void confirmLogout()}>{loggingOut ? t('profile.signingOut') : t('profile.confirmLogout')}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
