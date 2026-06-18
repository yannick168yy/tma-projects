import { Fragment, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Share2, Users, TrendingUp, Wallet, CheckCircle2, ChevronRight, Send, Zap, Info, Gem } from 'lucide-react'
import { fetchTeamStatus, enableAgent } from '@/api/promotion'
import type { TeamAgentStatus } from '@/types/api'
import { buildInviteDeepLink, buildInviteWebLink } from '@/constants/telegram'
import { useAuthStore } from '@/stores/auth'
import referralHero from '@/assets/home/promos/refer-win.webp'

interface Props {
  onOpenTeamCenter: () => void
}

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  return '₱' + val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 3-circle growth diagram
function TreeDiagram({ youLabel }: { youLabel: string }) {
  return (
    <svg viewBox="0 0 320 204" className="w-full" aria-hidden="true" style={{ maxHeight: 204 }}>
      <defs>
        <linearGradient id="tgLink01" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde047" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id="tgLink12" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.62" />
        </linearGradient>
        <linearGradient id="tgLink23" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.58" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="tgYou" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id="tgC1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
        <linearGradient id="tgC2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
        <linearGradient id="tgC3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <filter id="tgGlow" x="-30%" y="-40%" width="160%" height="180%">
          <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#000000" floodOpacity="0.28" />
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#fde047" floodOpacity="0.18" />
        </filter>
      </defs>

      <g opacity="0.5">
        <path d="M18 18H302M30 98H290M18 184H302" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="4 8" />
      </g>

      <g strokeLinecap="round" fill="none">
        <path d="M160 34C132 46 94 54 52 70" stroke="url(#tgLink01)" strokeWidth="2.4" />
        <path d="M160 34V70" stroke="url(#tgLink01)" strokeWidth="2.4" />
        <path d="M160 34C188 46 226 54 268 70" stroke="url(#tgLink01)" strokeWidth="2.4" />
        <path d="M52 94C44 106 35 114 27 128M52 94C59 106 66 114 73 128" stroke="url(#tgLink12)" strokeWidth="2" />
        <path d="M160 94C152 106 145 114 138 128M160 94C168 106 175 114 182 128" stroke="url(#tgLink12)" strokeWidth="2" />
        <path d="M268 94C260 106 254 114 248 128M268 94C276 106 283 114 290 128" stroke="url(#tgLink12)" strokeWidth="2" />
        <path d="M27 151V174M138 151C130 160 122 167 115 174M138 151C145 160 151 167 156 174M248 151C256 160 264 167 270 174" stroke="url(#tgLink23)" strokeWidth="1.8" />
      </g>

      <g filter="url(#tgGlow)">
        <rect x="121" y="0" width="78" height="34" rx="14" fill="url(#tgYou)" />
        <circle cx="140" cy="17" r="8" fill="#fff7ed" opacity="0.92" />
        <circle cx="140" cy="14" r="2.7" fill="#78350f" opacity="0.8" />
        <path d="M135.5 22C137 19.8 143 19.8 144.5 22" stroke="#78350f" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <text x="166" y="17" dominantBaseline="central" textAnchor="middle" fill="#78350f" fontSize="10" fontWeight="900">
        {youLabel}
      </text>

      {[52, 160, 268].map((cx) => (
        <g key={cx} filter="url(#tgGlow)">
          <rect x={cx - 32} y="68" width="64" height="28" rx="10" fill="rgba(8,13,24,0.72)" stroke="rgba(253,224,71,0.55)" />
          <circle cx={cx - 17} cy="82" r="8" fill="url(#tgC1)" />
          <circle cx={cx - 17} cy="79.5" r="2.4" fill="#78350f" opacity="0.72" />
          <path d={`M${cx - 22} 87C${cx - 19} 83.5 ${cx - 15} 83.5 ${cx - 12} 87`} stroke="#78350f" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx={cx + 20} cy="76" r="5" fill="#fbbf24" stroke="#fef3c7" strokeWidth="1" />
          <text x={cx + 7} y="84" dominantBaseline="central" textAnchor="middle" fill="#fde047" fontSize="10" fontWeight="900">C1</text>
        </g>
      ))}
      <text x="308" y="84" dominantBaseline="central" textAnchor="middle" fill="rgba(253,224,71,0.55)" fontSize="13" fontWeight="900">+</text>

      {[28, 72, 138, 182, 248, 290].map((cx) => (
        <g key={cx} filter="url(#tgGlow)">
          <rect x={cx - 23} y="128" width="46" height="25" rx="9" fill="rgba(8,13,24,0.66)" stroke="rgba(52,211,153,0.48)" />
          <path d={`M${cx - 20} 131H${cx + 20}`} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeLinecap="round" />
          <circle cx={cx - 10} cy="140.5" r="6.5" fill="url(#tgC2)" />
          <path d={`M${cx - 14} 144C${cx - 11.5} 141.5 ${cx - 8.5} 141.5 ${cx - 6} 144`} stroke="#064e3b" strokeWidth="1.1" strokeLinecap="round" />
          <text x={cx + 8} y="141" dominantBaseline="central" textAnchor="middle" fill="#a7f3d0" fontSize="8.5" fontWeight="900">C2</text>
          <circle cx={cx + 18} cy="132" r="4" fill="#fde047" opacity="0.95" />
          <path d={`M${cx + 16} 132H${cx + 20}M${cx + 18} 130V134`} stroke="#78350f" strokeWidth="0.9" strokeLinecap="round" />
        </g>
      ))}

      {[28, 115, 155, 270].map((cx) => (
        <g key={cx} filter="url(#tgGlow)">
          <rect x={cx - 19} y="174" width="38" height="22" rx="8" fill="rgba(8,13,24,0.62)" stroke="rgba(103,232,249,0.42)" />
          <circle cx={cx - 9} cy="185" r="5.4" fill="url(#tgC3)" />
          <text x={cx + 8} y="185" dominantBaseline="central" textAnchor="middle" fill="#67e8f9" fontSize="8" fontWeight="900">C3</text>
          <circle cx={cx + 14} cy="178" r="3.6" fill="#fbbf24" opacity="0.95" />
        </g>
      ))}
      <text x="214" y="187" dominantBaseline="central" textAnchor="middle" fill="rgba(103,232,249,0.5)" fontSize="13" fontWeight="900">+</text>
    </svg>
  )
}

export default function ReferralPromoPage({ onOpenTeamCenter }: Props) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [status, setStatus] = useState<TeamAgentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [enabling, setEnabling] = useState(false)
  const [copied, setCopied] = useState(false)

  const inviteCode = user?.inviteCode ?? ''
  const telegramLink = useMemo(() => buildInviteDeepLink(inviteCode), [inviteCode])
  const webShareLink = useMemo(() => buildInviteWebLink(inviteCode), [inviteCode])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    fetchTeamStatus()
      .then(setStatus)
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [user])

  const isAgent = status?.isAgent ?? false
  const isActivated = status?.activated ?? false
  const l1 = status?.ratePlan.l1RatePct ?? null
  const l2 = status?.ratePlan.l2RatePct ?? null
  const l3 = status?.ratePlan.l3RatePct ?? null

  async function onEnable() {
    setEnabling(true)
    try {
      await enableAgent()
      const updated = await fetchTeamStatus()
      setStatus(updated)
    } catch { /* ignore */ }
    finally { setEnabling(false) }
  }

  function onCopyLink() {
    void navigator.clipboard.writeText(telegramLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function onShareNative() {
    if (navigator.share) {
      void navigator.share({ title: 'BetoGo', text: telegramLink, url: webShareLink })
    } else {
      onCopyLink()
    }
  }

  function onShareTelegram() {
    const text = encodeURIComponent(`Join my 3-Circle Rewards on BetoGo — use my code ${inviteCode}!\n${telegramLink}`)
    const url = `https://t.me/share/url?url=${encodeURIComponent(telegramLink)}&text=${text}`
    window.open(url, '_blank')
  }

  const tiers = [
    {
      level: 1, label: t('referralPromo.l1Label'), desc: t('referralPromo.l1Desc'),
      color: 'from-amber-500/20 to-amber-600/10', badge: 'bg-amber-500/20 text-amber-400',
      border: 'border-amber-500/20', icon: 'text-amber-400', rate: l1,
    },
    {
      level: 2, label: t('referralPromo.l2Label'), desc: t('referralPromo.l2Desc'),
      color: 'from-blue-500/20 to-blue-600/10', badge: 'bg-blue-500/20 text-blue-400',
      border: 'border-blue-500/20', icon: 'text-blue-400', rate: l2,
    },
    {
      level: 3, label: t('referralPromo.l3Label'), desc: t('referralPromo.l3Desc'),
      color: 'from-purple-500/20 to-purple-600/10', badge: 'bg-purple-500/20 text-purple-400',
      border: 'border-purple-500/20', icon: 'text-purple-400', rate: l3,
    },
  ]

  const steps = [
    { step: '01', title: t('referralPromo.step1Title'), desc: t('referralPromo.step1Desc') },
    { step: '02', title: t('referralPromo.step2Title'), desc: t('referralPromo.step2Desc') },
    { step: '03', title: t('referralPromo.step3Title'), desc: t('referralPromo.step3Desc') },
  ]

  const questRules = [
    {
      icon: <Share2 size={15} />,
      title: t('referralPromo.questShareTitle'),
      desc: t('referralPromo.questShareDesc'),
      className: 'from-yellow-300 to-amber-400 text-amber-950',
    },
    {
      icon: <Users size={15} />,
      title: t('referralPromo.questCircleTitle'),
      desc: t('referralPromo.questCircleDesc'),
      className: 'from-emerald-300 to-teal-400 text-teal-950',
    },
    {
      icon: <Wallet size={15} />,
      title: t('referralPromo.questRewardTitle'),
      desc: t('referralPromo.questRewardDesc'),
      className: 'from-sky-300 to-cyan-400 text-cyan-950',
    },
  ]

  return (
    <div className="flex flex-col bg-background min-h-full">
      {/* Hero - 3-circle diagram + rewards */}
      <div className="relative overflow-hidden px-4 pt-[calc(var(--app-safe-top)+3rem)] pb-8 flex-shrink-0">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(150deg, rgba(5, 45, 39, 0.98) 0%, rgba(7, 92, 70, 0.94) 42%, rgba(8, 11, 20, 0.98) 100%)',
          }}
        />
        <img
          src={referralHero}
          alt=""
          className="pointer-events-none absolute -right-14 top-7 w-[58%] max-w-[235px] opacity-25 mix-blend-screen"
        />
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(135deg,rgba(250,204,21,0.18)_0%,transparent_34%),linear-gradient(315deg,rgba(45,212,191,0.16)_0%,transparent_36%)]" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-background pointer-events-none" />

        <div className="relative mb-4">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="inline-flex items-center gap-1.5 bg-yellow-300 text-yellow-950 rounded-full px-3 py-1 shadow-[0_8px_24px_rgba(250,204,21,0.28)]">
              <Gem size={11} />
              <span className="text-[10px] font-black uppercase tracking-widest">{t('referralPromo.subtitle')}</span>
            </div>
            <div className="rounded-full bg-teal-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-950 shadow-[0_8px_24px_rgba(45,212,191,0.28)]">
              {t('referralPromo.questBadge')}
            </div>
          </div>
          <h2 className="font-display font-black text-[2rem] text-white leading-[0.95] drop-shadow-[0_3px_0_rgba(0,0,0,0.24)]">
            {t('referralPromo.heading1')}<br />
            <span className="text-yellow-300">{t('referralPromo.heading2')}</span>
          </h2>
          <p className="mt-3 max-w-[330px] text-sm font-semibold leading-relaxed text-white/80">{t('referralPromo.heroParagraph')}</p>
        </div>

        <div className="relative mb-4 rounded-[1.5rem] border border-white/15 bg-black/30 p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-display text-[11px] font-black uppercase tracking-widest text-white/70">{t('referralPromo.questMapTitle')}</p>
            <span className="rounded-full bg-white/12 px-2 py-1 text-[10px] font-black text-yellow-200">{t('referralPromo.questRewardTag')}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-1.5">
            {[
              { code: 'C1', title: t('referralPromo.mapC1Title'), desc: t('referralPromo.mapC1Desc'), className: 'bg-yellow-300 text-yellow-950' },
              { code: 'C2', title: t('referralPromo.mapC2Title'), desc: t('referralPromo.mapC2Desc'), className: 'bg-emerald-300 text-emerald-950' },
              { code: 'C3', title: t('referralPromo.mapC3Title'), desc: t('referralPromo.mapC3Desc'), className: 'bg-cyan-300 text-cyan-950' },
            ].map((item, index) => (
              <Fragment key={item.code}>
                {index > 0 && <div className="flex items-center justify-center text-sm font-black text-white/45">›</div>}
                <div className="min-w-0 rounded-2xl bg-white/10 p-2 text-center">
                  <div className={`mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-xl text-xs font-black ${item.className}`}>{item.code}</div>
                  <p className="truncate text-[11px] font-black text-white">{item.title}</p>
                  <p className="mt-0.5 text-[9px] font-semibold leading-snug text-white/60">{item.desc}</p>
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        {/* 3-circle visual */}
        <div className="relative mb-4 rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-emerald-950/78 via-slate-950/82 to-cyan-950/58 px-2 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <TreeDiagram youLabel={t('referralPromo.pyramidYou')} />
        </div>

        <div className="relative mb-4 grid grid-cols-3 gap-2">
          {questRules.map((item) => (
            <div key={item.title} className={`min-h-[104px] rounded-2xl bg-gradient-to-br ${item.className} p-2.5 shadow-[0_10px_28px_rgba(0,0,0,0.22)]`}>
              <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-xl bg-white/45">{item.icon}</div>
              <p className="text-[11px] font-black leading-tight">{item.title}</p>
              <p className="mt-1 text-[9px] font-bold leading-snug opacity-75">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* Circle reward cards */}
        <div className="relative space-y-2.5">
          <p className="text-[10px] font-black text-amber-200/90 uppercase tracking-widest px-0.5">{t('referralPromo.ratesTitle')}</p>
          {tiers.map((tier) => (
            <div
              key={tier.level}
              className={`relative overflow-hidden rounded-2xl bg-gradient-to-r ${tier.color} border ${tier.border} p-3.5 flex items-center gap-3`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tier.badge}`}>
                <Users size={17} className={tier.icon} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${tier.badge}`}>C{tier.level}</span>
                  <span className="text-sm font-black text-foreground">{tier.label}</span>
                </div>
                <p className="text-[11px] text-foreground/75 leading-snug">{tier.desc}</p>
              </div>
              <div className="flex-shrink-0 text-right pl-1">
                {tier.rate !== null ? (
                  <>
                    <p className={`text-2xl font-black font-display leading-none ${tier.icon}`}>{tier.rate}%</p>
                    <p className="text-[9px] text-foreground/55 mt-0.5">{t('referralPromo.rateLabel')}</p>
                  </>
                ) : (
                  <div className="w-10 h-7 rounded animate-pulse bg-white/10" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active: circle snapshot + invite code + share CTA */}
      {!loading && isAgent && (
        <>
          {status && (status.l1Count > 0 || status.lifetimeEarnedCents > 0) && (
            <div className="mx-4 mt-5 rounded-2xl bg-card border border-border overflow-hidden flex-shrink-0">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp size={14} className="text-primary" />
                  <span className="font-display font-black text-sm text-foreground">{t('referralPromo.teamTitle')}</span>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-primary font-bold active:opacity-60"
                  onClick={onOpenTeamCenter}
                >
                  {t('referralPromo.teamDetails')} <ChevronRight size={12} />
                </button>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border">
                {[
                  { label: t('referralPromo.teamL1'), value: String(status.l1Count) },
                  { label: t('referralPromo.teamTotal'), value: String(status.l1Count + status.l2Count + status.l3Count) },
                  { label: t('referralPromo.teamEarned'), value: phpDisplay(status.lifetimeEarnedCents) },
                ].map((item) => (
                  <div key={item.label} className="py-3 px-2 text-center">
                    <p className="text-base font-black text-foreground">{item.value}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isActivated && (
            <div className="mx-4 mt-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 flex items-start gap-2.5 flex-shrink-0">
              <Info size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-300/80 leading-relaxed">{t('referralPromo.notActivatedHint')}</p>
            </div>
          )}

          {inviteCode && (
            <div className="mx-4 mt-5 rounded-2xl bg-secondary border border-border p-4 flex items-center gap-3 flex-shrink-0">
              <Wallet size={16} className="text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground">{t('referralPromo.codeLabel')}</p>
                <p className="font-display font-black text-primary tracking-widest text-base truncate">{inviteCode}</p>
              </div>
              <button
                type="button"
                onClick={onCopyLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 active:scale-95 transition-transform"
              >
                {copied
                  ? <CheckCircle2 size={13} className="text-emerald-400" />
                  : <Copy size={13} className="text-primary" />}
                <span className="text-[11px] font-bold text-primary">{copied ? t('referralPromo.copied') : t('referralPromo.copy')}</span>
              </button>
            </div>
          )}

          <div className="px-4 mt-5 space-y-3 flex-shrink-0">
            <button
              type="button"
              onClick={onShareNative}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 font-black text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-amber-500/30"
            >
              <Share2 size={16} />
              {t('referralPromo.ctaShare')}
            </button>
            <button
              type="button"
              onClick={onShareTelegram}
              className="w-full h-11 rounded-2xl border border-blue-500/30 bg-blue-500/10 text-blue-400 font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <Send size={15} />
              {t('referralPromo.ctaTelegram')}
            </button>
            <button
              type="button"
              onClick={onOpenTeamCenter}
              className="w-full h-11 rounded-2xl bg-secondary border border-border text-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <TrendingUp size={15} className="text-primary" />
              {t('referralPromo.ctaTeam')}
            </button>
          </div>
        </>
      )}

      {/* Inactive: steps + enable CTA */}
      {!loading && !isAgent && (
        <>
          <div className="px-4 mt-5 flex-shrink-0">
            <h3 className="font-display font-black text-xs text-muted-foreground uppercase tracking-widest mb-3">{t('referralPromo.stepsTitle')}</h3>
            <div className="space-y-3">
              {steps.map((item) => (
                <div key={item.step} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="font-display font-black text-[10px] text-primary">{item.step}</span>
                  </div>
                  <div className="pt-0.5">
                    <p className="text-sm font-bold text-foreground">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 mt-6 flex-shrink-0">
            <div className="rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-600/5 border border-amber-500/20 p-4 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={14} className="text-primary" />
                <span className="font-display font-black text-sm text-foreground">{t('referralPromo.enableTitle')}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{t('referralPromo.enableDesc')}</p>
            </div>
            <button
              type="button"
              onClick={() => void onEnable()}
              disabled={enabling}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 font-black text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-amber-500/30 disabled:opacity-60 disabled:pointer-events-none"
            >
              <Zap size={16} />
              {enabling ? t('referralPromo.enabling') : t('referralPromo.enableCta')}
            </button>
          </div>
        </>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="px-4 mt-5 space-y-3 flex-shrink-0">
          <div className="h-12 rounded-2xl animate-pulse bg-white/8" />
          <div className="h-11 rounded-2xl animate-pulse bg-white/5" />
        </div>
      )}

      <div className="h-4" />
    </div>
  )
}
