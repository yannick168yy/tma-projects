import { useState, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  History,
  Languages,
  LogOut,
  ScanFace,
  Smartphone,
  User,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import BindModal from '@/components/auth/BindModal'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { LANGUAGES } from '@/data/languages'
import { fetchRebateProgress } from '@/api/rebate'
import { fetchKycStatus, type KycStatus } from '@/api/kyc'
import menuCasino from '@/assets/home/promos/menu-card-casino.webp'

const ICONS = import.meta.glob('../assets/menu/icons/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const icon = (name: string): string => ICONS[`../assets/menu/icons/${name}.webp`]

interface Props {
  onOpenCs: () => void
  onLogin: () => void
  onLogout: () => void
  onOpenBetHistory: () => void
  onOpenLedgerRecords: () => void
  onOpenReferralPromo: () => void
  onOpenAgentCenter: () => void
  onOpenCashback: () => void
  onOpenRewardsSpin: () => void
  onOpenKycSetting: () => void
  onOpenTopUp: () => void
  onOpenCashOut: () => void
  onOpenWalletHistory: () => void
}

const CURRENCIES = [
  { icon: '28_php', name: 'PHP' },
  { icon: '29_usdt', name: 'USDT' },
  { icon: '30_ton', name: 'TON' },
  { icon: '21_btc', name: 'BTC' },
  { icon: '22_eth', name: 'ETH' },
  { icon: '23_bnb', name: 'BNB' },
]

const HOME_DOC_KEYS = new Set(['terms', 'privacy', 'responsible', 'about'])
type StatusIcon = ComponentType<{ size?: number; strokeWidth?: number }>

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
  icon,
  title,
  subtitle,
  right,
  onClick,
  danger = false,
  bordered = false,
}: {
  icon: string
  title: string
  subtitle?: string
  right?: ReactNode
  onClick?: () => void
  danger?: boolean
  bordered?: boolean
}) {
  const content = (
    <>
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${danger ? 'bg-red-500/10' : 'bg-secondary'}`}>
        <img src={icon} alt="" className="h-6 w-6 object-contain" />
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
  icon,
  label,
  onClick,
}: {
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-2 py-3 text-center transition-transform active:scale-[0.98] hover:bg-secondary/50"
      onClick={onClick}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary">
        <img src={icon} alt="" className="h-6 w-6 object-contain" />
      </span>
      <span className="block text-xs font-black capitalize leading-tight text-foreground">{label}</span>
    </button>
  )
}

function IdentityCardIcon({ size = 24, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2.2" />
      <path d="M8 8.5h3.2" />
      <circle cx="8.9" cy="12.1" r="1.55" />
      <path d="M6.4 16c.6-1.3 1.45-1.95 2.5-1.95S10.8 14.7 11.4 16" />
      <path d="M14 11h3.7" />
      <path d="M14 14.4h3" />
    </svg>
  )
}

function KycStatusIcon({ Icon, done, size = 20 }: { Icon: StatusIcon; done: boolean; size?: number }) {
  return (
    <span className={`relative flex flex-shrink-0 items-center justify-center ${done ? 'text-[#f8d978]' : 'text-white/60'}`} style={{ width: size, height: size }}>
      <Icon size={size} strokeWidth={1.8} />
      {done && (
        <span className="absolute -bottom-px -right-0.5 flex h-2 w-2 items-center justify-center rounded-full bg-white text-[#f8d978] shadow-[0_1px_2px_rgba(0,0,0,0.22)]">
          <Check size={5} strokeWidth={3} />
        </span>
      )}
    </span>
  )
}

function AccountInfoItem({
  title,
  value,
  icon,
  iconSize,
  done,
  onClick,
}: {
  title: string
  value: string
  icon: StatusIcon
  iconSize?: number
  done: boolean
  onClick?: () => void
}) {
  const content = (
    <>
      <p className="truncate text-[7px] font-black uppercase text-black/45">{title}</p>
      <div className="mt-1 flex min-w-0 items-center justify-center gap-1">
        <KycStatusIcon Icon={icon} done={done} size={iconSize} />
        <p className={`min-w-0 truncate text-[10px] font-black ${done ? 'text-[#f8d978]' : 'text-white/60'}`}>{value}</p>
      </div>
    </>
  )

  if (onClick && !done) {
    return (
      <button type="button" className="min-w-0 border-l border-white/20 px-1.5 py-2.5 text-center transition-colors hover:bg-white/10" onClick={onClick}>
        {content}
      </button>
    )
  }

  return (
    <div className="min-w-0 border-l border-white/20 px-1.5 py-2.5 text-center">
      {content}
    </div>
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

export default function MenuPage({ onOpenCs, onLogin, onLogout, onOpenBetHistory, onOpenLedgerRecords, onOpenReferralPromo, onOpenAgentCenter, onOpenCashback, onOpenRewardsSpin, onOpenKycSetting, onOpenTopUp, onOpenCashOut, onOpenWalletHistory }: Props) {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const { locale, setLocale } = useLocaleStore()
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore()
  const isLoggedIn = Boolean(auth.token && auth.user)

  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [bindOpen, setBindOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [comingSoonToast, setComingSoonToast] = useState(false)
  const [docModalKey, setDocModalKey] = useState<string | null>(null)
  const [langOpen, setLangOpen] = useState(false)
  const [rebateLevel, setRebateLevel] = useState<number | null>(null)
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null)
  const comingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const USER_ID = auth.user?.id ?? '—'
  const displayName = auth.user?.displayName ?? t('profile.playerAccount')
  const currentLang = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0]
  const kycApproved = kycStatus?.status === 'approved'
  const phoneVerified = kycApproved || Boolean(kycStatus?.phoneVerified)
  const docVerified = kycApproved || Boolean(kycStatus?.docVerified)
  const faceVerified = kycApproved || Boolean(kycStatus?.faceVerified)

  const SUPPORT_ITEMS = [
    { icon: '21_live_chat', label: t('profile.supportItems.liveChat'), sub: t('profile.supportItems.liveChatSub'), badge: t('common.online'), onClick: onOpenCs },
    { icon: '22_telegram', label: t('profile.supportItems.telegram'), sub: '@BetoGo_Support', badge: null, onClick: showComingSoon },
    { icon: '23_email', label: t('profile.supportItems.email'), sub: 'support@betogo.com', badge: null, onClick: showComingSoon },
  ]
  const COMMUNITY_LINKS = [
    { icon: '24_official_channel', label: t('profile.links.channel'), sub: t('profile.links.channelSub') },
    { icon: '25_community_group', label: t('profile.links.community'), sub: t('profile.links.communitySub') },
    { icon: '26_vip_club', label: t('profile.links.vip'), sub: t('profile.links.vipSub') },
    { icon: '27_facebook', label: t('profile.links.facebook'), sub: t('profile.links.facebookSub') },
  ]
  const DOCS = [
    { key: 'terms', icon: '05_terms_of_service', label: t('profile.docs.terms') },
    { key: 'privacy', icon: '06_privacy_policy', label: t('profile.docs.privacy') },
    { key: 'responsible', icon: '07_responsible_gaming', label: t('profile.docs.responsible') },
    { key: 'aml', icon: '08_aml_policy', label: t('profile.docs.aml') },
    { key: 'bonusTerms', icon: '09_bonus_terms', label: t('profile.docs.bonusTerms') },
    { key: 'about', icon: '10_about_us', label: t('profile.docs.about') },
  ]

  useEffect(() => {
    document.body.style.overflow = docModalKey ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [docModalKey])

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

  useEffect(() => {
    if (!isLoggedIn) {
      setKycStatus(null)
      return
    }
    fetchKycStatus()
      .then(setKycStatus)
      .catch(() => setKycStatus(null))
  }, [isLoggedIn, auth.user?.id])

  function showComingSoon() {
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current)
    setComingSoonToast(true)
    comingSoonTimer.current = setTimeout(() => setComingSoonToast(false), 2200)
  }

  function openKycFromStatus() {
    if (!isLoggedIn) { onLogin(); return }
    onOpenKycSetting()
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
          className="relative overflow-hidden rounded-3xl px-4 pb-3 pt-4 shadow-[0_18px_40px_rgba(0,0,0,0.32)]"
          style={{ background: 'linear-gradient(135deg, #e2af37 0%, #c79023 52%, #946615 100%)' }}
        >
          <img
            src={menuCasino}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -right-2 top-1 h-[112px] w-auto select-none"
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
            <div className="relative pr-24">
              <div className="flex min-h-[86px] items-center gap-3">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/15 text-white shadow-[0_10px_24px_rgba(0,0,0,0.22)]">
                  <User size={25} />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-[1.6rem] font-black leading-none text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.22)]">{t('auth.signInTitle')}</h1>
                </div>
              </div>
            </div>
          )}

          <div className="relative mt-4 grid grid-cols-4 overflow-hidden rounded-2xl bg-black/15">
            <div className="min-w-0 px-1.5 py-2.5 text-center">
              <p className="truncate text-[7px] font-black uppercase text-black/45">{t('menu.language')}</p>
              <div className="mt-1 flex min-w-0 items-center justify-center gap-1">
                <Languages size={20} className="flex-shrink-0 text-[#f8d978]" strokeWidth={1.8} />
                <p className="min-w-0 truncate text-[10px] font-black text-[#f8d978]">{currentLang.flag} {t(`languages.${currentLang.code}`)}</p>
              </div>
            </div>
            <AccountInfoItem
              title={t('kyc.stepPhone')}
              value={phoneVerified ? t('common.verified') : t('kyc.verify')}
              icon={Smartphone}
              done={phoneVerified}
              onClick={openKycFromStatus}
            />
            <AccountInfoItem
              title={t('kyc.stepDocument')}
              value={docVerified ? t('common.verified') : t('kyc.verify')}
              icon={IdentityCardIcon}
              iconSize={34}
              done={docVerified}
              onClick={openKycFromStatus}
            />
            <AccountInfoItem
              title={t('kyc.stepFace')}
              value={faceVerified ? t('kyc.matched') : t('kyc.match')}
              icon={ScanFace}
              done={faceVerified}
              onClick={openKycFromStatus}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 px-4">
        <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
          {([
            { Icon: ArrowDownToLine, label: t('menu.walletTopUp'), onClick: onOpenTopUp },
            { Icon: ArrowUpFromLine, label: t('menu.walletCashOut'), onClick: onOpenCashOut },
            { Icon: History, label: t('menu.walletRecords'), onClick: onOpenWalletHistory },
          ] as { Icon: typeof History; label: string; onClick: () => void }[]).map(({ Icon, label, onClick }, i) => (
            <button
              key={label}
              type="button"
              className={`flex items-center justify-center gap-1 px-1 py-4 transition-colors hover:bg-secondary/50 ${i < 2 ? 'border-r border-border' : ''}`}
              onClick={onClick}
            >
              <Icon size={17} className="flex-shrink-0 text-primary" />
              <span className="whitespace-nowrap text-xs font-black text-foreground">{label}</span>
              <ChevronRight size={13} className="flex-shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-5 px-4">
        <section>
          <div className="mb-2.5 flex items-center gap-2 px-1">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary shadow-[0_0_8px_rgba(255,184,0,0.55)]" />
            <h3 className="font-display text-sm font-black uppercase text-foreground">{t('profile.account')}</h3>
            <span className="h-px flex-1 bg-gradient-to-r from-primary/30 to-transparent" />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <QuickAction icon={icon('02_Bet_History')} label={t('profile.betHistory')} onClick={() => (isLoggedIn ? onOpenBetHistory() : onLogin())} />
            <QuickAction icon={icon('01_rewards')} label={t('menu.creditRecords')} onClick={() => void openLedger()} />
            <QuickAction icon={icon('account_login_methods')} label={t('bind.entry')} onClick={() => (isLoggedIn ? setBindOpen(true) : onLogin())} />
            <QuickAction icon={icon('07_personal_information')} label={t('kyc.settingEntry')} onClick={() => (isLoggedIn ? onOpenKycSetting() : onLogin())} />
          </div>
        </section>

        <MenuSection title={t('menu.rewards')}>
          <MenuRow icon={icon('03_3_circle_rewards')} title={t('referralPromo.title')} subtitle={t('referralPromo.subtitle')} onClick={onOpenReferralPromo} bordered />
          <MenuRow icon={icon('cashback')} title={t('category.cashback')} subtitle={t('cashback.pageSubtitle')} onClick={onOpenCashback} bordered />
          <MenuRow icon={icon('rewards_spin')} title={t('category.rewardsSpin')} subtitle={t('spin.kicker')} onClick={onOpenRewardsSpin} bordered={auth.user?.isAgent} />
          {auth.user?.isAgent && <MenuRow icon={icon('04_agent_center')} title={t('agentCenter.entry')} subtitle={t('agentCenter.entrySub')} onClick={onOpenAgentCenter} />}
        </MenuSection>

        <MenuSection title={t('menu.appearance')}>
          <div className="border-b border-border px-4 py-3.5">
            <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setLangOpen(!langOpen)}>
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary">
                <img src={icon('03_language')} alt="" className="h-6 w-6 object-contain" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-normal text-foreground">{t('menu.language')}</span>
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
                    <span className={`flex-1 text-sm font-normal ${locale === l.code ? 'text-primary' : 'text-white/70'}`}>{t(`languages.${l.code}`)}</span>
                    {locale === l.code && <Check size={14} className="text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="px-4 py-3.5">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary">
                <img src={icon('04_appearance')} alt="" className="h-6 w-6 object-contain" />
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
              icon={icon(item.icon)}
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
            <MenuRow key={item.label} icon={icon(item.icon)} title={item.label} subtitle={item.sub} bordered={i < COMMUNITY_LINKS.length - 1} onClick={showComingSoon} />
          ))}
        </MenuSection>

        <MenuSection title={t('profile.supportedCurrencies')}>
          <div className="grid grid-cols-6 gap-2 px-4 py-4">
            {CURRENCIES.map((c) => (
              <div key={c.name} className="flex flex-col items-center gap-1.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary"><img src={icon(c.icon)} alt="" className="h-7 w-7 object-contain" /></div>
                <span className="text-[10px] font-bold text-muted-foreground">{c.name}</span>
              </div>
            ))}
          </div>
        </MenuSection>

        <MenuSection title={t('profile.legalPolicies')}>
          {DOCS.map((d, i) => (
            <MenuRow key={d.key} icon={icon(d.icon)} title={d.label} bordered={i < DOCS.length - 1} onClick={() => setDocModalKey(d.key)} />
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
