import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy, ChevronDown, Users, Wallet } from 'lucide-react'
import { BONUS_WINNERS, PROMOS, PROMO_STATS } from '@/data/promos'
import { usePromotionStore, getHighlightMap } from '@/stores/promotion'
import { useAuthStore } from '@/stores/auth'

interface Props {
  promoFilter?: string | null
  onOpenWallet: () => void
  onOpenTeam: () => void
}

function phpDisplay(cents: number) {
  return '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function BonusesPage({ promoFilter, onOpenWallet, onOpenTeam }: Props) {
  const { t } = useTranslation()
  const promotionStore = usePromotionStore()
  const highlights = usePromotionStore((s) => s.highlights)
  const trialClaiming = usePromotionStore((s) => s.trialClaiming)
  const claimTrialIfEligible = usePromotionStore((s) => s.claimTrialIfEligible)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const trialEligible = useAuthStore((s) => s.trialEligible)
  const ensureLoggedIn = useAuthStore((s) => s.ensureLoggedIn)

  const highlightMap = useMemo(() => getHighlightMap(), [highlights])

  const [expanded, setExpanded] = useState<string | null>(promoFilter ?? null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [agentActivating, setAgentActivating] = useState(false)
  const [agentExpanded, setAgentExpanded] = useState(false)

  const teamStatus = promotionStore.teamStatus
  const promoConfig = usePromotionStore((s) => s.promoConfig)

  useEffect(() => {
    if (token && user) void promotionStore.loadTeamStatus()
  }, [token, user])

  useEffect(() => { void promotionStore.loadPromoConfig() }, [])

  useEffect(() => {
    if (promoFilter) {
      setExpanded(promoFilter)
      setTimeout(() => {
        document.getElementById(`promo-${promoFilter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [promoFilter])

  async function onActivateAgent() {
    if (!(await ensureLoggedIn(t('auth.signInProfile')))) return
    setAgentActivating(true)
    await promotionStore.enableAgent()
    setAgentActivating(false)
  }

  function isTrialClaimable() {
    return Boolean(highlightMap.get('trial')?.highlight ?? trialEligible)
  }

  async function onPromoCta(promoId: string) {
    setPromoError(null)
    if (promoId === 'firstdep') {
      onOpenWallet()
      return
    }
    if (promoId !== 'trial') return
    if (!(await ensureLoggedIn(t('auth.signInProfile')))) return
    const result = await claimTrialIfEligible()
    if (!result.ok && !result.alreadyClaimed && result.message) setPromoError(result.message)
  }

  const localizedPromos = useMemo(
    () =>
      PROMOS.map((p) => {
        const base = `bonuses.promos.${p.id}`
        const cfg = promoConfig

        let vars: Record<string, unknown> = {}
        let reward = p.reward
        if (p.id === 'trial' && cfg) {
          vars = { amount: cfg.trial.amount }
          reward = `₱ ${cfg.trial.amount}`
        } else if (p.id === 'referral' && cfg) {
          vars = { inviterAmount: cfg.referral.inviterAmount, inviteeAmount: cfg.referral.inviteeAmount }
          reward = `₱${cfg.referral.inviterAmount} / ₱${cfg.referral.inviteeAmount}`
        } else if (p.id === 'firstdep' && cfg) {
          vars = { matchPct: cfg.firstdep.matchPct, maxBonus: cfg.firstdep.maxBonus.toLocaleString('en-PH'), minDeposit: cfg.firstdep.minDeposit, turnoverX: cfg.firstdep.turnoverX }
          reward = `${cfg.firstdep.matchPct}%`
        }

        const stepList =
          p.id === 'referral'
            ? [t(`${base}.step1`, vars), t(`${base}.step2`, vars), t(`${base}.step3`, vars)]
            : [t(`${base}.step1`, vars), t(`${base}.step2`, vars)]
        return {
          ...p,
          reward,
          tag: t(`${base}.tag`),
          title: t(`${base}.title`),
          tagline: t(`${base}.tagline`, vars),
          rewardLabel: t(`${base}.rewardLabel`, vars),
          desc: t(`${base}.desc`, vars),
          badge: t(`${base}.badge`, vars),
          cta: t(`${base}.cta`),
          steps: stepList,
          expiry: p.expiry === 'Ongoing' ? t('common.ongoing') : t('common.limitedTime'),
        }
      }),
    [t, promoConfig],
  )

  const localizedStats = useMemo(
    () =>
      PROMO_STATS.map((s, i) => {
        const keys = ['distributed', 'active', 'winnersToday'] as const
        return { ...s, label: t(`bonuses.stats.${keys[i]}`) }
      }),
    [t],
  )

  const agentSteps = useMemo(
    () => [t('bonuses.promos.agent.step1'), t('bonuses.promos.agent.step2'), t('bonuses.promos.agent.step3')],
    [t],
  )

  return (
    <div className="page-main">
      <div
        className="relative px-4 pt-3 pb-5 overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #1a0060 0%, #080b14 60%)' }}
      >
        <p className="text-muted-foreground text-[11px] uppercase tracking-widest font-bold mb-1">
          {t('bonuses.exclusive')}
        </p>
        <h1 className="text-white font-black leading-tight mb-1 font-display text-[1.8rem]">
          {t('bonuses.titleLine1')}
          <br />
          <span className="text-primary">{t('bonuses.titleLine2')}</span>
        </h1>
        <p className="text-white/50 text-xs max-w-[220px] leading-relaxed">{t('bonuses.heroSub')}</p>
        <div className="flex gap-3 mt-4">
          {localizedStats.map((s) => (
            <div key={s.label} className="flex-1 bg-white/5 rounded-xl px-2.5 py-2 text-center border border-white/8">
              <p className="text-base leading-none mb-0.5">{s.icon}</p>
              <p className="text-primary font-black text-sm leading-none">{s.value}</p>
              <p className="text-white/40 text-[9px] mt-0.5 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-3 bg-secondary rounded-xl px-3 py-2 flex items-center gap-2 overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-1 text-primary">
          <Trophy size={12} />
          <span className="text-[10px] font-black uppercase whitespace-nowrap">{t('bonuses.recentClaims')}</span>
        </div>
        <div className="w-px h-3 bg-border flex-shrink-0" />
        <div className="overflow-hidden flex-1">
          <div className="flex gap-5 animate-marquee whitespace-nowrap" style={{ animationDuration: '14s' }}>
            {[...BONUS_WINNERS, ...BONUS_WINNERS].map((w, i) => (
              <span key={i} className="text-[11px] flex-shrink-0">
                <span className="text-primary font-bold">{w.name}</span>
                <span className="text-white/50"> {t('common.claimed')} </span>
                <span className="text-emerald-400 font-bold">{w.amount}</span>
                <span className="text-white/30"> · {w.promo}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-3">
        <div className="rounded-2xl overflow-hidden border border-amber-500/30">
          <div className="relative bg-gradient-to-br from-[#78350f] via-[#92400e] to-[#b45309] px-4 py-4">
            <span className="text-3xl absolute top-3 right-4">🏆</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-300">
              {t('bonuses.promos.agent.tag')}
            </span>

            {!teamStatus?.isAgent ? (
              <>
                <h2 className="text-white font-black leading-tight mt-0.5 font-display text-[1.3rem]">
                  {t('bonuses.promos.agent.title')}
                </h2>
                <p className="text-white/60 text-xs mt-0.5">{t('bonuses.promos.agent.tagline')}</p>
                <div className="flex gap-2 mt-3">
                  <div className="flex-1 bg-black/30 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-lg leading-none">25%</div>
                    <div className="text-white/50 text-[9px] mt-0.5">{t('bonuses.promos.agent.rateL1')}</div>
                  </div>
                  <div className="flex-1 bg-black/30 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-lg leading-none">8%</div>
                    <div className="text-white/50 text-[9px] mt-0.5">{t('bonuses.promos.agent.rateL2')}</div>
                  </div>
                  <div className="flex-1 bg-black/30 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-lg leading-none">3%</div>
                    <div className="text-white/50 text-[9px] mt-0.5">{t('bonuses.promos.agent.rateL3')}</div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-white font-black leading-tight mt-0.5 font-display text-[1.3rem]">
                  {t('bonuses.promos.agent.title')}
                </h2>
                <div className="flex gap-2 mt-3">
                  <div className="flex-1 bg-black/30 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Users size={10} className="text-amber-400" />
                      <span className="text-white/50 text-[9px]">{t('bonuses.promos.agent.teamLabel')}</span>
                    </div>
                    <div className="text-amber-400 font-black text-sm leading-none">
                      C1 {teamStatus.l1Count} · C2 {teamStatus.l2Count} · C3 {teamStatus.l3Count}
                    </div>
                  </div>
                  <div className="bg-black/30 rounded-xl px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1 mb-0.5">
                      <Wallet size={10} className="text-amber-400" />
                      <span className="text-white/50 text-[9px]">{t('bonuses.promos.agent.commissionLabel')}</span>
                    </div>
                    <div className="text-amber-400 font-black text-sm leading-none">
                      {phpDisplay(teamStatus.availableCents)}
                    </div>
                  </div>
                </div>
                {!teamStatus.activated && (
                  <div className="mt-2 bg-amber-500/15 border border-amber-500/30 rounded-lg px-3 py-1.5">
                    <p className="text-amber-300 text-[10px] leading-relaxed">
                      {t('bonuses.promos.agent.activationHint')}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-card px-4 py-3">
            <p className="text-muted-foreground text-xs leading-relaxed">{t('bonuses.promos.agent.desc')}</p>

            <button
              type="button"
              className="w-full flex items-center justify-between mt-3 py-2 border-t border-border"
              onClick={() => setAgentExpanded((v) => !v)}
            >
              <span className="text-foreground text-xs font-bold">{t('bonuses.howItWorks')}</span>
              <ChevronDown
                size={14}
                className={`text-muted-foreground transition-transform duration-200 ${agentExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            {agentExpanded && (
              <div className="pb-2 space-y-2">
                {agentSteps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 font-black text-[11px] text-black mt-0.5 bg-amber-400">
                      {i + 1}
                    </div>
                    <span className="text-foreground/80 text-xs leading-relaxed">{step}</span>
                  </div>
                ))}
              </div>
            )}

            {!teamStatus?.isAgent ? (
              <button
                type="button"
                className={`w-full mt-3 py-3 rounded-xl text-black font-black text-sm transition-opacity bg-amber-500 hover:bg-amber-400 ${agentActivating ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={() => void onActivateAgent()}
              >
                {agentActivating ? t('bonuses.promos.agent.activating') : t('bonuses.promos.agent.cta')}
              </button>
            ) : (
              <button
                type="button"
                className="w-full mt-3 py-3 rounded-xl text-black font-black text-sm bg-amber-500 hover:bg-amber-400 transition-colors"
                onClick={onOpenTeam}
              >
                {t('bonuses.promos.agent.ctaActive')}
              </button>
            )}
          </div>
        </div>

        {localizedPromos.map((p) => (
          <div
            key={p.id}
            id={`promo-${p.id}`}
            className={`rounded-2xl overflow-hidden border ${p.highlight ? 'border-purple-500/40' : 'border-white/8'} ${promoFilter === p.id ? 'ring-2 ring-primary/60' : ''}`}
          >
            <div className={`relative bg-gradient-to-br px-4 py-4 ${p.gradient}`}>
              {p.highlight && (
                <div className="absolute top-3 right-3 bg-primary text-primary-foreground text-[10px] font-black px-2 py-0.5 rounded-full">
                  {t('bonuses.featuredBadge')}
                </div>
              )}
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-12">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: p.accentColor }}>
                    {p.tag}
                  </span>
                  <h2 className="text-white font-black leading-tight mt-0.5 font-display text-[1.3rem]">{p.title}</h2>
                  <p className="text-white/60 text-xs mt-0.5">{p.tagline}</p>
                </div>
                <span className="text-3xl">{p.icon}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="bg-black/30 rounded-xl px-3 py-1.5 flex items-baseline gap-1.5">
                  <span className="text-white font-black text-xl leading-none font-display">{p.reward}</span>
                  <span className="text-white/60 text-xs">{p.rewardLabel}</span>
                </div>
                <span className={`text-[10px] font-black px-2 py-1 rounded-full ${p.badgeColor}`}>{p.badge}</span>
                <span className="ml-auto text-[10px] text-white/40 font-semibold">🕐 {p.expiry}</span>
              </div>
            </div>

            <div className="bg-card px-4 py-3">
              <p className="text-muted-foreground text-xs leading-relaxed">{p.desc}</p>
              <button
                type="button"
                className="w-full flex items-center justify-between mt-3 py-2 border-t border-border"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              >
                <span className="text-foreground text-xs font-bold">{t('bonuses.howItWorks')}</span>
                <ChevronDown
                  size={14}
                  className={`text-muted-foreground transition-transform duration-200 ${expanded === p.id ? 'rotate-180' : ''}`}
                />
              </button>
              {expanded === p.id && (
                <div className="pb-2 space-y-2">
                  {p.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 font-black text-[11px] text-black mt-0.5"
                        style={{ background: p.accentColor }}
                      >
                        {i + 1}
                      </div>
                      <span className="text-foreground/80 text-xs leading-relaxed">{step}</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                disabled={p.id === 'trial' && (!isTrialClaimable() || trialClaiming)}
                className={`w-full mt-3 py-3 rounded-xl text-white font-black text-sm transition-colors ${p.ctaColor} ${p.id === 'trial' && (!isTrialClaimable() || trialClaiming) ? 'opacity-50 pointer-events-none' : ''}`}
                onClick={() => void onPromoCta(p.id)}
              >
                {p.id === 'trial' && trialClaiming
                  ? t('bonuses.promos.trial.claiming')
                  : p.id === 'trial' && !isTrialClaimable()
                    ? t('bonuses.promos.trial.ctaClaimed')
                    : p.cta}
              </button>
              {p.id === 'trial' && promoError && (
                <p className="mt-2 text-[11px] text-red-400 text-center">{promoError}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-4 mt-4 mb-2 bg-secondary/50 rounded-xl px-4 py-3 border border-border">
        <p className="text-muted-foreground text-[11px] leading-relaxed text-center">{t('bonuses.disclaimer')}</p>
      </div>
    </div>
  )
}
