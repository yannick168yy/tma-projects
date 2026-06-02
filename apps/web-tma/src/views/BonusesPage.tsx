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


export default function BonusesPage({ promoFilter, onOpenWallet, onOpenTeam }: Props) {
  const { t } = useTranslation()
  const promotionStore = usePromotionStore()
  const auth = useAuthStore()
  const [expanded, setExpanded] = useState<string | null>(promoFilter ?? null)
  const [agentActivating, setAgentActivating] = useState(false)
  const [agentExpanded, setAgentExpanded] = useState(false)

  const teamStatus = promotionStore.teamStatus
  const highlightMap = useMemo(() => getHighlightMap(), [promotionStore.highlights])

  useEffect(() => {
    if (auth.token && auth.user) void promotionStore.loadTeamStatus()
  }, [auth.token])

  useEffect(() => {
    if (promoFilter) {
      setExpanded(promoFilter)
      setTimeout(() => { document.getElementById(`promo-${promoFilter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 100)
    }
  }, [promoFilter])

  async function onActivateAgent() {
    if (!(await auth.ensureLoggedIn(t('auth.signInProfile')))) return
    setAgentActivating(true)
    await promotionStore.enableAgent()
    setAgentActivating(false)
  }

  const localizedPromos = useMemo(() =>
    PROMOS.map((p) => {
      const base = `bonuses.promos.${p.id}`
      const stepList = p.id === 'referral'
        ? [t(`${base}.step1`), t(`${base}.step2`), t(`${base}.step3`)]
        : [t(`${base}.step1`), t(`${base}.step2`)]
      return {
        ...p,
        tag: t(`${base}.tag`), title: t(`${base}.title`), tagline: t(`${base}.tagline`),
        rewardLabel: t(`${base}.rewardLabel`), desc: t(`${base}.desc`), badge: t(`${base}.badge`),
        cta: t(`${base}.cta`), steps: stepList,
        expiry: p.expiry === 'Ongoing' ? t('common.ongoing') : t('common.limitedTime'),
      }
    }), [t])

  const localizedStats = useMemo(() =>
    PROMO_STATS.map((s, i) => {
      const keys = ['distributed', 'active', 'winnersToday'] as const
      return { ...s, label: t(`bonuses.stats.${keys[i]}`) }
    }), [t])

  return (
    <div className="page-main pb-6">
      {/* Stats bar */}
      <div className="flex gap-3 px-4 pt-4 pb-3">
        {localizedStats.map((s) => (
          <div key={s.label} className="flex-1 bg-secondary rounded-2xl p-3 text-center border border-border">
            <div className="text-primary font-black text-base leading-none">{s.value}</div>
            <div className="text-muted-foreground text-[10px] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Marquee winners */}
      <div className="mx-4 mb-4 bg-secondary rounded-xl p-3 flex items-center gap-2 overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-1.5 text-primary">
          <Trophy size={13} />
          <span className="text-xs font-bold uppercase tracking-wide whitespace-nowrap">{t('bonuses.recentWinners')}</span>
        </div>
        <div className="w-px h-4 bg-border flex-shrink-0" />
        <div className="overflow-hidden flex-1">
          <div className="flex gap-6 animate-marquee whitespace-nowrap">
            {[...BONUS_WINNERS, ...BONUS_WINNERS].map((w, i) => (
              <span key={i} className="text-xs text-foreground/80 flex-shrink-0">
                <span className="text-primary font-bold">{w.name}</span>
                {' '}{t('common.won')}{' '}
                <span className="text-emerald-400 font-bold">{w.amount}</span>
                {' · '}<span className="text-muted-foreground">{w.promo}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Promo cards */}
      <div className="px-4 space-y-3">
        {localizedPromos.map((promo) => {
          const highlight = highlightMap.get(promo.id as 'trial' | 'referral' | 'firstdep')
          const isExpanded = expanded === promo.id
          return (
            <div key={promo.id} id={`promo-${promo.id}`} className="overflow-hidden rounded-2xl border border-border bg-card">
              <button
                type="button"
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${isExpanded ? 'bg-primary/5' : 'hover:bg-secondary/50'}`}
                onClick={() => setExpanded(isExpanded ? null : promo.id)}
              >
                <span className="text-2xl">{promo.badge}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-primary/15 text-primary">{promo.tag}</span>
                    {highlight?.highlight && highlight.flagLabel && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">{highlight.flagLabel}</span>
                    )}
                  </div>
                  <p className="text-foreground font-black text-sm mt-1">{promo.title}</p>
                  <p className="text-muted-foreground text-xs">{promo.tagline}</p>
                </div>
                <ChevronDown size={16} className={`text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
              {isExpanded && (
                <div className="px-4 pb-4 pt-2 border-t border-border">
                  <p className="text-foreground/80 text-xs leading-relaxed mb-3">{promo.desc}</p>
                  <div className="space-y-1.5 mb-4">
                    {promo.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-black flex items-center justify-center mt-0.5">{i + 1}</span>
                        <p className="text-xs text-foreground/70 leading-relaxed">{step}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-secondary rounded-xl p-3">
                      <p className="text-[10px] text-muted-foreground">{promo.rewardLabel}</p>
                      <p className="text-primary font-black text-sm">{promo.expiry}</p>
                    </div>
                    <button
                      type="button"
                      className="flex-shrink-0 bg-primary text-primary-foreground font-black text-xs px-5 py-3 rounded-xl shadow shadow-amber-500/20"
                      onClick={() => void auth.ensureLoggedIn(t('auth.signInBonus'))}
                    >
                      {promo.cta}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Agent CTA */}
      <div className="mx-4 mt-6 rounded-2xl overflow-hidden border border-amber-500/20" style={{ background: 'linear-gradient(135deg, #1a0040, #3b0020)' }}>
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🤝</span>
            <div>
              <p className="text-amber-400 text-[10px] font-black uppercase tracking-widest">{t('bonuses.agentProgram')}</p>
              <p className="text-white font-black text-base">{t('bonuses.agentTitle')}</p>
            </div>
          </div>
          <p className="text-white/60 text-xs mb-4">{t('bonuses.agentDesc')}</p>
          {teamStatus?.isAgent ? (
            <div className="space-y-2">
              <div className="bg-black/30 rounded-xl p-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {([1, 2, 3] as const).map((lvl) => (
                    <div key={lvl}>
                      <div className="text-amber-400 font-black text-lg leading-none">{teamStatus[`l${lvl}Count` as 'l1Count' | 'l2Count' | 'l3Count']}</div>
                      <div className="text-white/50 text-[9px] mt-0.5">L{lvl}</div>
                    </div>
                  ))}
                </div>
              </div>
              <button type="button" className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500/20 text-amber-400 font-black text-sm" onClick={onOpenTeam}>
                <Users size={14} />{t('bonuses.viewTeam')}
              </button>
              <button type="button" className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 text-black font-black text-sm" onClick={onOpenWallet}>
                <Wallet size={14} />{t('bonuses.withdraw')}
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm transition-colors ${agentExpanded ? 'bg-amber-500 text-black' : 'bg-amber-500/20 text-amber-400'}`}
                onClick={() => { if (!agentExpanded) { setAgentExpanded(true); return } void onActivateAgent() }}
                disabled={agentActivating}
              >
                {agentActivating ? '...' : agentExpanded ? t('bonuses.confirmActivate') : t('bonuses.activate')}
              </button>
              {agentExpanded && (
                <p className="text-white/50 text-[10px] text-center mt-2">{t('bonuses.agentActivateHint')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
