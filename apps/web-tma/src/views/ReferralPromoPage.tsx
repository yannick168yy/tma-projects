import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Share2, Users, TrendingUp, Wallet, CheckCircle2, ChevronRight, Send, Zap, Info, Gift, Link2, Network } from 'lucide-react'
import { fetchTeamStatus, enableAgent } from '@/api/promotion'
import type { TeamAgentStatus } from '@/types/api'
import { buildInviteDeepLink, buildInviteWebLink } from '@/constants/telegram'
import { useAuthStore } from '@/stores/auth'
import referralPeople from '@/assets/home/promos/referral-people.webp'

interface Props {
  onOpenTeamCenter: () => void
}

function phpDisplay(cents: number) {
  const val = (cents ?? 0) / 100
  return '₱' + val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 3-circle structure tree: You -> C1 -> C2 -> C3 across three branches
function TreeDiagram({ youLabel }: { youLabel: string }) {
  const cols = [60, 170, 280]
  return (
    <svg viewBox="0 0 340 232" className="w-full" aria-hidden="true">
      <defs>
        <linearGradient id="tgYou" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>

      {/* You -> C1 (dashed) */}
      <g stroke="#22c55e" strokeWidth="1.6" strokeDasharray="3 4" opacity="0.7" fill="none">
        {cols.map((cx) => <path key={cx} d={`M170 44 L${cx} 70`} />)}
      </g>
      {/* C1 -> C2 */}
      <g stroke="#3b82f6" strokeWidth="1.6" opacity="0.6" fill="none">
        {cols.map((cx) => <path key={cx} d={`M${cx} 94 L${cx} 122`} />)}
      </g>
      {/* C2 -> C3 */}
      <g stroke="#f59e0b" strokeWidth="1.6" opacity="0.55" fill="none">
        <path d="M60 146 C60 159 42 160 42 174" />
        <path d="M60 146 C60 159 78 160 78 174" />
        <path d="M170 146 L170 174" />
        <path d="M280 146 C280 159 262 160 262 174" />
        <path d="M280 146 C280 159 298 160 298 174" />
      </g>

      {/* You node */}
      <circle cx="170" cy="26" r="16" fill="url(#tgYou)" />
      <circle cx="170" cy="22" r="4.6" fill="#06281a" opacity="0.85" />
      <path d="M162 33 C164 28.5 176 28.5 178 33" stroke="#06281a" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.85" />
      <text x="192" y="26" dominantBaseline="central" fill="#ffffff" fontSize="11" fontWeight="800">{youLabel}</text>

      {/* C1 (green) */}
      {cols.map((cx) => (
        <g key={`c1-${cx}`}>
          <rect x={cx - 21} y="70" width="42" height="24" rx="8" fill="#0f2c1b" stroke="#22c55e" strokeWidth="1.2" />
          <text x={cx} y="82" dominantBaseline="central" textAnchor="middle" fill="#4ade80" fontSize="11" fontWeight="900">C1</text>
        </g>
      ))}
      {/* C2 (blue) */}
      {cols.map((cx) => (
        <g key={`c2-${cx}`}>
          <rect x={cx - 21} y="122" width="42" height="24" rx="8" fill="#0e2240" stroke="#3b82f6" strokeWidth="1.2" />
          <text x={cx} y="134" dominantBaseline="central" textAnchor="middle" fill="#60a5fa" fontSize="11" fontWeight="900">C2</text>
        </g>
      ))}
      {/* C3 (amber) */}
      {[42, 78, 170, 262, 298].map((cx) => (
        <g key={`c3-${cx}`}>
          <rect x={cx - 18} y="174" width="36" height="22" rx="7" fill="#34250d" stroke="#f59e0b" strokeWidth="1.1" />
          <text x={cx} y="185.5" dominantBaseline="central" textAnchor="middle" fill="#fbbf24" fontSize="10" fontWeight="900">C3</text>
        </g>
      ))}
      {/* people icons under each branch */}
      {cols.map((cx) => (
        <g key={`p-${cx}`} opacity="0.4" fill="none" stroke="#94a3b8" strokeWidth="1.4">
          <circle cx={cx - 6} cy="211" r="3" />
          <path d={`M${cx - 11} 220 C${cx - 11} 215 ${cx - 1} 215 ${cx - 1} 220`} />
          <circle cx={cx + 6} cy="211" r="3" />
          <path d={`M${cx + 1} 220 C${cx + 1} 215 ${cx + 11} 215 ${cx + 11} 220`} />
        </g>
      ))}
    </svg>
  )
}

export default function ReferralPromoPage({ onOpenTeamCenter }: Props) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const ensureLoggedIn = useAuthStore((s) => s.ensureLoggedIn)
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
  // 未登录时用默认费率展示（与后端默认套餐一致）
  const l1 = status?.ratePlan.l1RatePct ?? (user ? null : 0.6)
  const l2 = status?.ratePlan.l2RatePct ?? (user ? null : 0.3)
  const l3 = status?.ratePlan.l3RatePct ?? (user ? null : 0.2)

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
      color: 'from-emerald-500/20 to-emerald-600/10', badge: 'bg-emerald-500/20 text-emerald-400',
      border: 'border-emerald-500/25', icon: 'text-emerald-400', rate: l1,
    },
    {
      level: 2, label: t('referralPromo.l2Label'), desc: t('referralPromo.l2Desc'),
      color: 'from-blue-500/20 to-blue-600/10', badge: 'bg-blue-500/20 text-blue-400',
      border: 'border-blue-500/25', icon: 'text-blue-400', rate: l2,
    },
    {
      level: 3, label: t('referralPromo.l3Label'), desc: t('referralPromo.l3Desc'),
      color: 'from-amber-500/20 to-amber-600/10', badge: 'bg-amber-500/20 text-amber-400',
      border: 'border-amber-500/25', icon: 'text-amber-400', rate: l3,
    },
  ]

  const features = [
    { icon: <Link2 size={18} />, ring: 'bg-emerald-400/15 text-emerald-300', title: t('referralPromo.featShareTitle'), desc: t('referralPromo.featShareDesc') },
    { icon: <Users size={18} />, ring: 'bg-emerald-400/15 text-emerald-300', title: t('referralPromo.featGrowTitle'), desc: t('referralPromo.featGrowDesc') },
    { icon: <Wallet size={18} />, ring: 'bg-amber-400/15 text-amber-300', title: t('referralPromo.featEarnTitle'), desc: t('referralPromo.featEarnDesc') },
  ]

  const steps = [
    { step: '01', title: t('referralPromo.step1Title'), desc: t('referralPromo.step1Desc') },
    { step: '02', title: t('referralPromo.step2Title'), desc: t('referralPromo.step2Desc') },
    { step: '03', title: t('referralPromo.step3Title'), desc: t('referralPromo.step3Desc') },
  ]

  return (
    <div className="flex flex-col bg-background min-h-full">
      {/* Hero - people + headline */}
      <div className="relative overflow-hidden px-4 pt-[calc(var(--app-safe-top)+3rem)] pb-7 flex-shrink-0">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(165deg, #0c1626 0%, #0e1c30 42%, #070b14 100%)',
          }}
        />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(60%_42%_at_85%_12%,rgba(34,197,94,0.16)_0%,transparent_70%),radial-gradient(52%_40%_at_8%_28%,rgba(56,189,248,0.10)_0%,transparent_70%)]" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background pointer-events-none" />

        {/* top badges */}
        <div className="relative flex items-center justify-between gap-2 mb-4">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 px-3 py-1 text-amber-300">
            <Users size={11} />
            <span className="text-[9px] font-black uppercase tracking-widest">{t('referralPromo.subtitle')}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-emerald-300">
            <Gift size={11} />
            <span className="text-[9px] font-black uppercase tracking-widest">{t('referralPromo.questBadge')}</span>
          </div>
        </div>

        {/* headline */}
        <div className="relative mb-1">
          <h2 className="font-display font-black text-[2rem] text-white leading-[0.98] drop-shadow-[0_3px_0_rgba(0,0,0,0.3)]">
            {t('referralPromo.heading1')}<br />
            <span className="text-emerald-400">{t('referralPromo.heading2')}</span>
          </h2>
          <p className="mt-3 max-w-[330px] text-sm font-semibold leading-relaxed text-white/75">{t('referralPromo.heroParagraph')}</p>
        </div>

        {/* people image, edges blended into background */}
        <div className="relative -mx-4 -mt-2 mb-2">
          <img
            src={referralPeople}
            alt=""
            className="pointer-events-none mx-auto w-full max-w-[460px]"
            style={{
              WebkitMaskImage: 'radial-gradient(76% 80% at 50% 44%, #000 48%, transparent 86%)',
              maskImage: 'radial-gradient(76% 80% at 50% 44%, #000 48%, transparent 86%)',
            }}
          />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-background pointer-events-none" />
        </div>

        {/* feature row */}
        <div className="relative mb-4 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3">
          <div className="grid grid-cols-3 divide-x divide-white/10">
            {features.map((f) => (
              <div key={f.title} className="flex flex-col items-center px-1 text-center">
                <div className={`mb-1.5 flex h-9 w-9 items-center justify-center rounded-full ${f.ring}`}>{f.icon}</div>
                <p className="text-[11px] font-black leading-tight text-white">{f.title}</p>
                <p className="mt-0.5 text-[9px] font-semibold leading-snug text-white/55">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 3-circle structure */}
        <div className="relative mb-4 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Network size={14} className="text-emerald-400" />
              <p className="font-display text-[11px] font-black uppercase tracking-widest text-white/80">{t('referralPromo.structureTitle')}</p>
            </div>
            <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[9px] font-black text-emerald-300">{t('referralPromo.questRewardTag')}</span>
          </div>
          <TreeDiagram youLabel={t('referralPromo.pyramidYou')} />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[9.5px] font-bold">
            <span className="flex items-center gap-1 text-emerald-300"><span className="h-2 w-2 rounded-sm bg-emerald-400" />C1 · {t('referralPromo.treeDirect')}</span>
            <span className="flex items-center gap-1 text-blue-300"><span className="h-2 w-2 rounded-sm bg-blue-400" />C2 · {t('referralPromo.treeFriendsC1')}</span>
            <span className="flex items-center gap-1 text-amber-300"><span className="h-2 w-2 rounded-sm bg-amber-400" />C3 · {t('referralPromo.treeFriendsC2')}</span>
          </div>
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
              onClick={() => (user ? void onEnable() : void ensureLoggedIn(t('auth.signInProfile')))}
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
