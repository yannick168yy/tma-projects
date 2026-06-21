import { useState, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Gift,
  Headphones,
  History,
  Info,
  Languages,
  LogOut,
  Mail,
  MessageCircle,
  Palette,
  Send,
  ShieldCheck,
  User,
  Users,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import BindModal from '@/components/auth/BindModal'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { LANGUAGES } from '@/data/languages'
import type { LoginProvider } from '@/types/api'
import { formatTelegramHandle, getTelegramWebAppUser } from '@/utils/telegramUser'
import { patchProfile } from '@/api/auth'
import { fetchRebateProgress } from '@/api/rebate'
import ContactBrandIcon from '@/components/profile/ContactBrandIcon'
import ContactMethodRow from '@/components/profile/ContactMethodRow'
import menuCasino from '@/assets/home/promos/menu-card-casino.webp'

interface Props {
  onOpenCs: () => void
  onLogin: () => void
  onLogout: () => void
  onOpenBetHistory: () => void
  onOpenLedgerRecords: () => void
  onOpenReferralPromo: () => void
  onOpenAgentCenter: () => void
}

type MenuIcon = ComponentType<{ size?: number; className?: string }>

const CURRENCIES = [
  { symbol: '₱', name: 'PHP' },
  { symbol: '₮', name: 'USDT' },
  { symbol: 'T', name: 'TON' },
  { symbol: '₿', name: 'BTC' },
  { symbol: 'Ξ', name: 'ETH' },
  { symbol: 'B', name: 'BNB' },
]

const HOME_DOC_KEYS = new Set(['terms', 'privacy', 'responsible', 'about'])

function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary shadow-[0_0_8px_rgba(255,184,0,0.55)]" />
        <h3 className="font-display text-sm font-black uppercase text-foreground">{title}</h3>
        <span className="h-px flex-1 bg-gradient-to-r from-primary/30 to-transparent" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_10px_30px_rgba(0,0,0,0.16)]">{children}</div>
    </section>
  )
}

function MenuRow({
  icon: Icon,
  title,
  subtitle,
  right,
  onClick,
  danger = false,
  bordered = false,
}: {
  icon: MenuIcon
  title: string
  subtitle?: string
  right?: ReactNode
  onClick?: () => void
  danger?: boolean
  bordered?: boolean
}) {
  const content = (
    <>
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${danger ? 'bg-red-500/10 text-red-400' : 'bg-secondary text-primary'}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-sm font-bold ${danger ? 'text-red-400' : 'text-foreground'}`}>{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      {right ?? (onClick ? <ChevronRight size={15} className="flex-shrink-0 text-muted-foreground" /> : null)}
    </>
  )

  const className = `flex w-full items-center gap-3 px-4 py-3.5 ${bordered ? 'border-b border-border' : ''} ${onClick ? 'transition-colors hover:bg-secondary/50' : ''}`

  if (!onClick) return <div className={className}>{content}</div>
  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  )
}

function QuickAction({
  icon: Icon,
  label,
  subtitle,
  onClick,
  featured = false,
}: {
  icon: MenuIcon
  label: string
  subtitle: string
  onClick: () => void
  featured?: boolean
}) {
  return (
    <button
      type="button"
      className={`relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-2xl border px-3 py-3 text-left transition-transform active:scale-[0.98] ${featured ? 'border-primary/30 bg-primary/10' : 'border-border bg-card hover:bg-secondary/50'}`}
      onClick={onClick}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${featured ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
        <Icon size={18} />
      </span>
      <span>
        <span className="block text-xs font-black leading-tight text-foreground">{label}</span>
        <span className="mt-1 block truncate text-[10px] font-semibold text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  )
}

function BottomSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[200] flex justify-center" role="dialog" aria-modal="true">
      <div className="relative flex h-full w-full max-w-[430px] flex-col justify-end">
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <div className="relative z-10 flex max-h-[86vh] flex-col rounded-t-2xl bg-card shadow-2xl">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-display text-base font-black text-foreground">{title}</h2>
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary" onClick={onClose}>
              <X size={15} className="text-muted-foreground" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
        </div>
      </div>
    </div>,
    document.getElementById('app') ?? document.body,
  )
}

export default function MenuPage({ onOpenCs, onLogin, onLogout, onOpenBetHistory, onOpenLedgerRecords, onOpenReferralPromo, onOpenAgentCenter }: Props) {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const { locale, setLocale } = useLocaleStore()
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore()
  const isLoggedIn = Boolean(auth.token && auth.user)

  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [bindOpen, setBindOpen] = useState(false)
  const [profileSheetOpen, setProfileSheetOpen] = useState(false)
  const [contactSheetOpen, setContactSheetOpen] = useState(false)
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
  const [rebateLevel, setRebateLevel] = useState<number | null>(null)
  const comingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const USER_ID = auth.user?.id ?? '—'
  const displayName = auth.user?.displayName ?? t('profile.playerAccount')
  const currentLang = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0]

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

  const MONTHS = Array.from({ length: 12 }, (_, i) => t(`profile.months.${i + 1}`))
  const genderOptions = [{ id: 'Male', label: t('profile.male') }, { id: 'Female', label: t('profile.female') }, { id: 'Other', label: t('profile.other') }]
  const years = Array.from({ length: new Date().getFullYear() - 1924 }, (_, i) => new Date().getFullYear() - 18 - i)
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
  const dobFilled = !!(dobMonth && dobDay && dobYear)
  const dobDisplay = dobFilled ? `${MONTHS[parseInt(dobMonth, 10) - 1]} ${parseInt(dobDay, 10)}, ${dobYear}` : ''
  const profileComplete = Boolean(firstName && lastName && dobFilled && gender)
  const canSavePersonal = profileComplete && !personalSaved

  const SUPPORT_ITEMS = [
    { icon: MessageCircle, label: t('profile.supportItems.liveChat'), sub: t('profile.supportItems.liveChatSub'), badge: t('common.online'), onClick: onOpenCs },
    { icon: Send, label: t('profile.supportItems.telegram'), sub: '@BetoGo_Support', badge: null, onClick: showComingSoon },
    { icon: Mail, label: t('profile.supportItems.email'), sub: 'support@betogo.com', badge: null, onClick: showComingSoon },
  ]
  const COMMUNITY_LINKS = [
    { icon: Send, label: t('profile.links.channel'), sub: t('profile.links.channelSub') },
    { icon: Users, label: t('profile.links.community'), sub: t('profile.links.communitySub') },
    { icon: Gift, label: t('profile.links.vip'), sub: t('profile.links.vipSub') },
    { icon: MessageCircle, label: t('profile.links.facebook'), sub: t('profile.links.facebookSub') },
  ]
  const DOCS = [
    { key: 'terms', label: t('profile.docs.terms') },
    { key: 'privacy', label: t('profile.docs.privacy') },
    { key: 'responsible', label: t('profile.docs.responsible') },
    { key: 'aml', label: t('profile.docs.aml') },
    { key: 'bonusTerms', label: t('profile.docs.bonusTerms') },
    { key: 'about', label: t('profile.docs.about') },
  ]

  useEffect(() => {
    const p = auth.user?.profile
    if (p) {
      setFirstName(p.firstName ?? '')
      setLastName(p.lastName ?? '')
      setGender(p.gender ?? '')
      setDobMonth(p.dobMonth ?? '')
      setDobDay(p.dobDay ?? '')
      setDobYear(p.dobYear ?? '')
    }
  }, [auth.user?.id])

  useEffect(() => {
    document.body.style.overflow = docModalKey || profileSheetOpen || contactSheetOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [docModalKey, profileSheetOpen, contactSheetOpen])

  useEffect(() => () => { if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current) }, [])

  useEffect(() => {
    if (!isLoggedIn) {
      setRebateLevel(null)
      return
    }
    fetchRebateProgress()
      .then((progress) => setRebateLevel(progress.level))
      .catch(() => setRebateLevel(null))
  }, [isLoggedIn, auth.user?.id])

  function showComingSoon() {
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current)
    setComingSoonToast(true)
    comingSoonTimer.current = setTimeout(() => setComingSoonToast(false), 2200)
  }

  async function openLedger() {
    if (!isLoggedIn) { onLogin(); return }
    onOpenLedgerRecords()
  }

  function copyId() {
    if (!auth.user?.id) return
    navigator.clipboard?.writeText(auth.user.id).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function confirmLogout() {
    setLoggingOut(true)
    try {
      await auth.logout()
      setLogoutConfirmOpen(false)
      onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  async function savePersonal() {
    if (!canSavePersonal) return
    setPersonalSaving(true)
    setPersonalError('')
    try {
      const saved = await patchProfile({ firstName, lastName, gender: gender as 'male' | 'female' | 'other' | '', dobMonth, dobDay, dobYear })
      if (auth.user) useAuthStore.setState((s) => ({ ...s, user: { ...s.user!, profile: saved } }))
      setPersonalSaved(true)
      setDobOpen(false)
    } catch (e) {
      setPersonalError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setPersonalSaving(false)
    }
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
      if (isHeading && i + 1 < chunks.length) {
        sections.push({ heading: chunk, body: chunks[i + 1] })
        i++
      } else {
        sections.push({ heading: null, body: chunk })
      }
    }
    return sections
  }

  return (
    <div className="page-main min-h-full pb-24">
      <div className="px-4 pb-1 pt-3">
        <div
          className="relative min-h-[194px] overflow-hidden rounded-3xl px-4 pb-4 pt-5 shadow-[0_18px_40px_rgba(0,0,0,0.32)]"
          style={{ background: 'linear-gradient(135deg, #e2af37 0%, #c79023 52%, #946615 100%)' }}
        >
          <img
            src={menuCasino}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -right-2 top-2 h-32 w-auto select-none"
          />
          {isLoggedIn ? (
            <div className="relative pr-24">
              <div className="flex items-start gap-3">
                <div className="relative flex-shrink-0">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/40 bg-white/15 text-white shadow-[0_10px_24px_rgba(0,0,0,0.22)]">
                    <User size={25} />
                  </div>
                  <span className="absolute -right-1 -top-1 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-amber-300 shadow">LV{rebateLevel ?? 1}</span>
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-black/45">{t('profile.playerAccount')}</p>
                  <h1 className="truncate font-display text-[1.6rem] font-black leading-none text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.22)]">{displayName}</h1>
                  <button type="button" className="mt-2 flex max-w-full items-center gap-1.5 transition-opacity hover:opacity-80" onClick={copyId}>
                    <span className="text-xs font-semibold text-black/50">ID:</span>
                    <span className="truncate text-xs font-black text-amber-950">{USER_ID}</span>
                    {copied ? <CheckCircle2 size={12} className="flex-shrink-0 text-emerald-800" /> : <Copy size={12} className="flex-shrink-0 text-black/45" />}
                  </button>
                </div>
              </div>
              {copied && <p className="mt-2 text-[10px] font-semibold text-emerald-900">{t('common.copied')}</p>}
            </div>
          ) : (
            <div className="relative flex items-center gap-4 pr-20">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/15 text-white">
                <User size={25} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-black/45">{t('nav.menu')}</p>
                <h1 className="font-display text-[1.5rem] font-black leading-none text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.22)]">{t('auth.signInTitle')}</h1>
                <p className="mt-1 text-xs leading-relaxed text-black/55">{t('auth.signInSubtitle')}</p>
              </div>
              <button
                type="button"
                className="flex-shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-black text-amber-300 shadow-lg transition-colors hover:bg-zinc-800"
                onClick={onLogin}
              >
                {t('shell.signIn')}
              </button>
            </div>
          )}

          <div className="relative mt-5 grid grid-cols-3 overflow-hidden rounded-2xl bg-black/15">
            <div className="flex items-center gap-1.5 px-2.5 py-2.5">
              <Languages size={14} className="flex-shrink-0 text-amber-100/80" />
              <div className="min-w-0">
                <p className="truncate text-[8px] font-black uppercase tracking-wide text-black/45">{t('menu.language')}</p>
                <p className="truncate text-[11px] font-black text-white">{currentLang.flag} {t(`languages.${currentLang.code}`)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 border-x border-white/15 px-2.5 py-2.5">
              <Headphones size={14} className="flex-shrink-0 text-amber-100/80" />
              <div className="min-w-0">
                <p className="truncate text-[8px] font-black uppercase tracking-wide text-black/45">{t('menu.customerSupport')}</p>
                <p className="truncate text-[11px] font-black text-white">{t('menu.live247')}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-2.5">
              <Gift size={14} className="flex-shrink-0 text-amber-100/80" />
              <div className="min-w-0">
                <p className="truncate text-[8px] font-black uppercase tracking-wide text-black/45">{t('menu.creditRecords')}</p>
                <p className="truncate text-[11px] font-black text-white">{t('menu.creditRecordsSub')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-card px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1 text-emerald-400">
            <Headphones size={12} />
            <span className="text-[10px] font-black">{t('common.online')}</span>
          </div>
          <p className="truncate text-[10px] font-semibold text-muted-foreground">{t('profile.supportItems.liveChatSub')}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1 text-primary">
            <ShieldCheck size={12} />
            <span className="text-[10px] font-black">{t('bind.entry')}</span>
          </div>
          <p className="truncate text-[10px] font-semibold text-muted-foreground">{isLoggedIn ? t('common.verified') : t('shell.signIn')}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1 text-primary">
            <Languages size={12} />
            <span className="text-[10px] font-black">{t('menu.language')}</span>
          </div>
          <p className="truncate text-[10px] font-semibold text-muted-foreground">{currentLang.flag} {t(`languages.${currentLang.code}`)}</p>
        </div>
      </div>

      <div className="mt-4 space-y-5 px-4">
        <div className="grid grid-cols-2 gap-2">
          <QuickAction icon={Gift} label={t('menu.creditRecords')} subtitle={t('menu.creditRecordsSub')} featured onClick={() => void openLedger()} />
          {isLoggedIn && <QuickAction icon={History} label={t('profile.betHistory')} subtitle={t('profile.account')} onClick={onOpenBetHistory} />}
          {isLoggedIn && <QuickAction icon={Gift} label={t('referralPromo.title')} subtitle={t('common.featured')} onClick={onOpenReferralPromo} />}
          {isLoggedIn && auth.user?.isAgent && <QuickAction icon={Users} label={t('agentCenter.entry')} subtitle={t('agentCenter.entrySub')} onClick={onOpenAgentCenter} />}
          <QuickAction icon={Headphones} label={t('menu.customerSupport')} subtitle={t('menu.live247')} onClick={onOpenCs} />
        </div>

        {isLoggedIn ? (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <ShieldCheck size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-black text-foreground">{t('profile.account')}</h2>
                <p className="truncate text-xs text-muted-foreground">{profileComplete || personalSaved ? t('common.verified') : t('profile.saveLock')}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-secondary/60 px-3 py-2">
                <p className="text-[10px] font-bold text-muted-foreground">{t('bind.entry')}</p>
                <p className="mt-1 truncate text-xs font-black text-foreground">{loginProvider === 'google' ? t('profile.google') : t('profile.telegram')}</p>
              </div>
              <div className="rounded-xl bg-secondary/60 px-3 py-2">
                <p className="text-[10px] font-bold text-muted-foreground">{t('profile.contactInfo')}</p>
                <p className="mt-1 truncate text-xs font-black text-foreground">{telegramSubtitle}</p>
              </div>
            </div>
            <div className="mt-3">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-left text-sm font-black text-foreground transition-colors hover:bg-primary/15"
                onClick={() => setProfileSheetOpen(true)}
              >
                <span>{t('profile.personalInfo')}</span>
                {profileComplete || personalSaved ? <CheckCircle2 size={16} /> : <ChevronRight size={16} />}
              </button>
            </div>
          </div>
        ) : null}

        {isLoggedIn && (
          <MenuSection title={t('profile.account')}>
            <MenuRow icon={ShieldCheck} title={t('bind.entry')} subtitle={loginProvider === 'google' ? t('profile.google') : t('profile.telegram')} onClick={() => setBindOpen(true)} bordered />
            <MenuRow
              icon={User}
              title={t('profile.personalInfo')}
              subtitle={profileComplete || personalSaved ? t('common.verified') : t('profile.saveLock')}
              right={profileComplete || personalSaved ? <CheckCircle2 size={15} className="text-emerald-400" /> : <ChevronRight size={15} className="text-muted-foreground" />}
              onClick={() => setProfileSheetOpen(true)}
              bordered
            />
            <MenuRow icon={AtSign} title={t('profile.contactInfo')} subtitle={telegramSubtitle} onClick={() => setContactSheetOpen(true)} />
          </MenuSection>
        )}

        <MenuSection title={t('menu.appearance')}>
          <div className="border-b border-border px-4 py-3.5">
            <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setLangOpen(!langOpen)}>
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <Languages size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-foreground">{t('menu.language')}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{currentLang.flag} {t(`languages.${currentLang.code}`)}</span>
              </span>
              <ChevronDown size={15} className={`text-muted-foreground transition-transform ${langOpen ? 'rotate-180' : ''}`} />
            </button>
            {langOpen && (
              <div className="mt-3 overflow-hidden rounded-xl border border-border bg-secondary/40">
                {LANGUAGES.map((l, i) => (
                  <button
                    key={l.code}
                    type="button"
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary ${i < LANGUAGES.length - 1 ? 'border-b border-border' : ''}`}
                    onClick={() => { setLocale(l.code as Parameters<typeof setLocale>[0]); setLangOpen(false) }}
                  >
                    <span className="text-lg">{l.flag}</span>
                    <span className={`flex-1 text-sm font-bold ${locale === l.code ? 'text-primary' : 'text-foreground'}`}>{t(`languages.${l.code}`)}</span>
                    {locale === l.code && <Check size={14} className="text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="px-4 py-3.5">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <Palette size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{t('menu.appearance')}</p>
                <p className="text-xs text-muted-foreground">{t(`menu.theme${themeMode.charAt(0).toUpperCase()}${themeMode.slice(1)}`)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'dark', label: t('menu.themeDark') },
                { key: 'light', label: t('menu.themeLight') },
                { key: 'system', label: t('menu.themeSystem') },
              ] as { key: ThemeMode; label: string }[]).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`min-h-9 rounded-xl border px-2 text-xs font-bold transition-colors ${themeMode === opt.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setThemeMode(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </MenuSection>

        <MenuSection title={t('profile.customerSupportSection')}>
          {SUPPORT_ITEMS.map((item, i) => (
            <MenuRow
              key={item.label}
              icon={item.icon}
              title={item.label}
              subtitle={item.sub}
              bordered={i < SUPPORT_ITEMS.length - 1}
              right={item.badge ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">{item.badge}</span> : <ChevronRight size={15} className="text-muted-foreground" />}
              onClick={item.onClick}
            />
          ))}
        </MenuSection>

        <MenuSection title={t('profile.communityMedia')}>
          {COMMUNITY_LINKS.map((item, i) => (
            <MenuRow key={item.label} icon={item.icon} title={item.label} subtitle={item.sub} bordered={i < COMMUNITY_LINKS.length - 1} onClick={showComingSoon} />
          ))}
        </MenuSection>

        <MenuSection title={t('profile.supportedCurrencies')}>
          <div className="grid grid-cols-6 gap-2 px-4 py-4">
            {CURRENCIES.map((c) => (
              <div key={c.name} className="flex flex-col items-center gap-1.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary text-sm font-black text-foreground">{c.symbol}</div>
                <span className="text-[10px] font-bold text-muted-foreground">{c.name}</span>
              </div>
            ))}
          </div>
        </MenuSection>

        <MenuSection title={t('profile.legalPolicies')}>
          {DOCS.map((d, i) => (
            <MenuRow key={d.key} icon={i === DOCS.length - 1 ? Info : FileText} title={d.label} bordered={i < DOCS.length - 1} onClick={() => setDocModalKey(d.key)} />
          ))}
        </MenuSection>

        {isLoggedIn && (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 py-3 text-sm font-black text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-60"
            disabled={loggingOut}
            onClick={() => setLogoutConfirmOpen(true)}
          >
            <LogOut size={16} />
            {t('profile.logout')}
          </button>
        )}

        <div className="space-y-1 py-4 text-center">
          <p className="text-xs text-muted-foreground">{t('profile.footerVersion')}</p>
          <p className="text-xs text-muted-foreground">{t('profile.footerCopyright')}</p>
          <p className="mt-2 px-4 text-[10px] leading-relaxed text-muted-foreground">{t('profile.footerLegal')}</p>
        </div>
      </div>

      {comingSoonToast && createPortal(
        <div className="profile-toast fixed left-1/2 z-[200] flex max-w-[min(320px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3" role="status" aria-live="polite">
          <span className="profile-toast__icon flex-shrink-0 text-lg leading-none">↗</span>
          <div className="min-w-0">
            <p className="profile-toast__title text-sm font-black leading-tight">{t('profile.comingSoon')}</p>
            <p className="mt-0.5 text-xs leading-snug text-foreground/75">{t('profile.comingSoonSub')}</p>
          </div>
        </div>,
        document.getElementById('app') ?? document.body,
      )}

      {profileSheetOpen && (
        <BottomSheet title={t('profile.personalInfo')} onClose={() => setProfileSheetOpen(false)}>
          <div className="space-y-4">
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
            {personalError && <p className="text-center text-xs font-bold text-red-400">{personalError}</p>}
            {!personalSaved && (
              <button type="button" className="w-full rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground shadow shadow-amber-500/20 transition-colors hover:bg-yellow-400 disabled:opacity-50" disabled={personalSaving || !canSavePersonal} onClick={() => void savePersonal()}>
                {personalSaving ? '保存中…' : t('profile.saveLock')}
              </button>
            )}
          </div>
        </BottomSheet>
      )}

      {contactSheetOpen && (
        <BottomSheet title={t('profile.contactInfo')} onClose={() => setContactSheetOpen(false)}>
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
                    subtitleSlot={<div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">+63</span><input value={phone} type="tel" placeholder="9XX XXX XXXX" className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none" onChange={(e) => setPhone(e.target.value)} /></div>}
                  />
                )}
              </div>
            ))}
          </div>
        </BottomSheet>
      )}

      {docModalKey && (
        <BottomSheet title={docTitle} onClose={() => setDocModalKey(null)}>
          <div className="space-y-4">
            {parsedDocContent().map((s, i) => (
              <div key={i}>
                {s.heading && <p className="mb-1.5 border-l-2 border-primary pl-2.5 font-display text-[11px] font-black uppercase tracking-widest text-primary">{s.heading}</p>}
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/70">{s.body}</p>
              </div>
            ))}
          </div>
        </BottomSheet>
      )}

      <BindModal open={bindOpen} onClose={() => setBindOpen(false)} />

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
