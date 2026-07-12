import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy, ChevronDown, Users, Wallet } from 'lucide-react'
import { BONUS_WINNERS, PROMOS } from '@/data/promos'
import { usePromotionStore, getHighlightMap } from '@/stores/promotion'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { fetchAppdlStatus, claimAppdlBonus, matchPopupAudience, type NewPlayerSummary, type BonusCard } from '@/api/promotion'
import { isStandalone } from '@/utils/pwa'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'
import { analytics } from '@/utils/analytics'
import TrialClaimModal from '@/components/promotion/TrialClaimModal'
import bonusesHero from '@/assets/home/promos/bonuses-hero.webp'

interface Props {
  promoFilter?: string | null
  onOpenWallet: () => void
  onOpenTeam: () => void
  onOpenAppInstall: () => void
  newPlayerSummary?: NewPlayerSummary | null
  onOpenNewPlayerGift?: () => void
  onOpenCheckin: () => void
}

function phpDisplay(cents: number) {
  return '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 后台 bonusCards 配置缺失/弱网未加载时的兜底顺序，保证页面不空白
const DEFAULT_BONUS_CARDS: BonusCard[] = [
  { id: 'checkin', enabled: true, order: 1, audience: 'all' },
  { id: 'agent', enabled: true, order: 2, audience: 'all' },
  { id: 'trial', enabled: true, order: 3, audience: 'all' },
  { id: 'appdl', enabled: false, order: 4, audience: 'all' },
  { id: 'firstdep', enabled: true, order: 5, audience: 'all' },
]

export default function BonusesPage({ promoFilter, onOpenWallet, onOpenTeam, onOpenAppInstall, newPlayerSummary, onOpenNewPlayerGift, onOpenCheckin }: Props) {
  const { t } = useTranslation()
  const promotionStore = usePromotionStore()
  const highlights = usePromotionStore((s) => s.highlights)
  const trialClaiming = usePromotionStore((s) => s.trialClaiming)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const trialEligible = useAuthStore((s) => s.trialEligible)
  const ensureLoggedIn = useAuthStore((s) => s.ensureLoggedIn)

  const highlightMap = useMemo(() => getHighlightMap(), [highlights])
  const bonusWinners = useMemo(() => Array.from({ length: 24 }, (_, i) => BONUS_WINNERS[i % BONUS_WINNERS.length]), [])

  const [expanded, setExpanded] = useState<string | null>(promoFilter ?? null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [trialModalOpen, setTrialModalOpen] = useState(false)
  const [appdlClaimed, setAppdlClaimed] = useState(false)
  const [appdlClaiming, setAppdlClaiming] = useState(false)
  const [appdlMsg, setAppdlMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const inApp = isStandalone()
  const [agentActivating, setAgentActivating] = useState(false)
  const [agentExpanded, setAgentExpanded] = useState(false)

  const teamStatus = promotionStore.teamStatus
  const promoConfig = usePromotionStore((s) => s.promoConfig)

  useEffect(() => {
    if (token && user) void promotionStore.loadTeamStatus()
  }, [token, user])

  useEffect(() => { void promotionStore.loadPromoConfig() }, [])

  // App 内已登录时查询下载礼金领取状态
  useEffect(() => {
    if (!inApp || !token || !user) return
    fetchAppdlStatus().then((st) => setAppdlClaimed(st.claimed)).catch(() => {})
  }, [inApp, token, user])

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
    const res = await promotionStore.enableAgent()
    if (res.ok) analytics.agentActivated()
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
    if (promoId === 'appdl') {
      if (!inApp) {
        onOpenAppInstall()
        return
      }
      if (appdlClaimed || appdlClaiming) return
      if (!(await ensureLoggedIn(t('auth.signInBonus')))) return
      setAppdlMsg(null)
      setAppdlClaiming(true)
      try {
        const res = await claimAppdlBonus('pwa')
        setAppdlClaimed(true)
        setAppdlMsg({ ok: true, text: t('bonuses.promos.appdl.claimSuccess', { amount: res.amountPhp }) })
        void useWalletStore.getState().refresh()
      } catch (e) {
        setAppdlMsg({ ok: false, text: e instanceof Error ? e.message : 'Claim failed' })
      } finally {
        setAppdlClaiming(false)
      }
      return
    }
    if (promoId !== 'trial') return
    if (!(await ensureLoggedIn(t('auth.signInProfile')))) return
    // 领礼金前先引导绑定手机号（短信验证），绑定成功后在弹窗内领取
    setTrialModalOpen(true)
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
        } else if (p.id === 'appdl' && cfg?.appdl) {
          vars = { amount: cfg.appdl.amount }
          reward = `₱ ${cfg.appdl.amount}`
        } else if (p.id === 'firstdep' && cfg) {
          const phpTiers = cfg.firstdep.tiers?.PHP ?? []
          const maxBonus = phpTiers.length ? Math.max(...phpTiers.map((tier) => tier.bonusAmount)) : 0
          vars = { maxBonus: maxBonus.toLocaleString('en-PH'), turnoverX: cfg.firstdep.turnoverX }
          reward = `₱${maxBonus.toLocaleString('en-PH')}`
        }

        const stepList =
          p.id === 'firstdep'
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

  const agentSteps = useMemo(
    () => [t('bonuses.promos.agent.step1'), t('bonuses.promos.agent.step2'), t('bonuses.promos.agent.step3')],
    [t],
  )

  // 后台统一编排：按 bonusCards 的开关 + 覆盖人群 + 顺序决定 Bonuses 页卡片
  const orderedCards = useMemo(() => {
    const deposited = highlightMap.get('firstdep')?.highlight === false
    const cards = promoConfig?.bonusCards?.length ? promoConfig.bonusCards : DEFAULT_BONUS_CARDS
    return [...cards]
      .filter((c) => c.enabled)
      .filter((c) => matchPopupAudience(c.audience, Boolean(token), deposited))
      .filter((c) => {
        if (c.id === 'appdl') return !isInsideTelegram() // Telegram 内无法安装 PWA/APK
        if (c.id === 'checkin') return promoConfig?.checkinEnabled !== false // 签到功能自身也需开启
        return true
      })
      .sort((a, b) => a.order - b.order)
  }, [promoConfig, token, highlightMap])

  type LocalizedPromo = (typeof localizedPromos)[number]

  function renderPromoCard(p: LocalizedPromo) {
    return (
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
            disabled={(p.id === 'trial' && (!isTrialClaimable() || trialClaiming)) || (p.id === 'appdl' && inApp && (appdlClaimed || appdlClaiming))}
            className={`w-full mt-3 py-3 rounded-xl text-white font-black text-sm transition-colors ${p.ctaColor} ${((p.id === 'trial' && (!isTrialClaimable() || trialClaiming)) || (p.id === 'appdl' && inApp && (appdlClaimed || appdlClaiming))) ? 'opacity-50 pointer-events-none' : ''}`}
            onClick={() => void onPromoCta(p.id)}
          >
            {p.id === 'trial' && trialClaiming
              ? t('bonuses.promos.trial.claiming')
              : p.id === 'trial' && !isTrialClaimable()
                ? t('bonuses.promos.trial.ctaClaimed')
                : p.id === 'appdl' && inApp
                  ? (appdlClaiming
                    ? t('bonuses.promos.appdl.claiming')
                    : appdlClaimed
                      ? t('bonuses.promos.appdl.ctaClaimed')
                      : t('bonuses.promos.appdl.ctaClaim', { amount: promoConfig?.appdl?.amount ?? '' }))
                  : p.cta}
          </button>
          {p.id === 'trial' && promoError && (
            <p className="mt-2 text-[11px] text-red-400 text-center">{promoError}</p>
          )}
          {p.id === 'appdl' && !inApp && (
            <p className="mt-2 text-[11px] text-muted-foreground text-center">{t('bonuses.promos.appdl.openInApp')}</p>
          )}
          {p.id === 'appdl' && appdlMsg && (
            <p className={`mt-2 text-[11px] text-center ${appdlMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{appdlMsg.text}</p>
          )}
        </div>
      </div>
    )
  }

  function renderCheckinCard() {
    return (
      <div key="checkin" className="rounded-2xl overflow-hidden border border-primary/30">
        <div className="relative bg-gradient-to-br from-[#2b1259] via-[#1a1440] to-[#141B2D] px-4 py-4">
          <span className="text-3xl absolute top-3 right-4">📅</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-primary">{t('checkin.entryTag')}</span>
          <h2 className="text-white font-black leading-tight mt-0.5 font-display text-[1.3rem]">{t('checkin.entryTitle')}</h2>
          <p className="text-white/60 text-xs mt-0.5">{t('checkin.entryDesc')}</p>
        </div>
        <div className="bg-card px-4 py-3">
          <button
            type="button"
            className="w-full py-3 rounded-xl text-primary-foreground font-black text-sm bg-primary hover:opacity-90 transition-opacity"
            onClick={onOpenCheckin}
          >
            {t('checkin.entryCta')}
          </button>
        </div>
      </div>
    )
  }

  function renderAgentCard() {
    return (
      <div key="agent" className="rounded-2xl overflow-hidden border border-amber-500/30">
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
                {([
                  [teamStatus?.ratePlan?.l1RatePct ?? 0.6, t('bonuses.promos.agent.rateL1')],
                  [teamStatus?.ratePlan?.l2RatePct ?? 0.3, t('bonuses.promos.agent.rateL2')],
                  [teamStatus?.ratePlan?.l3RatePct ?? 0.2, t('bonuses.promos.agent.rateL3')],
                ] as const).map(([rate, label]) => (
                  <div key={label} className="flex-1 bg-black/30 rounded-xl p-2 text-center">
                    <div className="text-amber-400 font-black text-lg leading-none">{rate}%</div>
                    <div className="text-white/50 text-[9px] mt-0.5">{label}</div>
                  </div>
                ))}
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
    )
  }

  function renderCard(id: BonusCard['id']) {
    if (id === 'agent') return renderAgentCard()
    if (id === 'checkin') return renderCheckinCard()
    const p = localizedPromos.find((x) => x.id === id)
    return p ? renderPromoCard(p) : null
  }

  return (
    <div className="page-main">
      <div className="relative overflow-hidden bg-[#080b14] pb-[18px]">
        <img src={bonusesHero} alt="" className="block w-full h-auto" />
        <div className="absolute inset-x-0 top-0 h-[8%] bg-gradient-to-b from-[#080b14] to-transparent" />
        <div className="absolute inset-x-0 bottom-[18px] h-[20%] bg-gradient-to-b from-transparent to-[#080b14]" />
        <div className="absolute inset-x-4 bottom-0 z-10 bg-secondary/95 rounded-xl px-3 py-2 flex items-center gap-2 overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <div className="flex-shrink-0 flex items-center gap-1 text-primary">
            <Trophy size={12} />
            <span className="text-[10px] font-black uppercase whitespace-nowrap">{t('bonuses.recentClaims')}</span>
          </div>
          <div className="w-px h-3 bg-border flex-shrink-0" />
          <div className="overflow-hidden flex-1">
            <div className="flex w-max animate-marquee whitespace-nowrap" style={{ animationDuration: '92s' }}>
              {[0, 1].map((group) => (
                <div key={group} className="flex flex-shrink-0 gap-5 pr-5">
                  {bonusWinners.map((w, i) => (
                    <span key={`${group}-${i}`} className="text-[11px] flex-shrink-0">
                      <span className="text-primary font-bold">{w.name}</span>
                      <span className="text-white/50"> {t('common.claimed')} </span>
                      <span className="text-emerald-400 font-bold">{w.amount}</span>
                      <span className="text-white/30"> · {w.promo}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-3">
        {orderedCards.map((c) => renderCard(c.id))}

        {/* New Player Gifts 测试入口：放在最底部，不纳入后台编排 */}
        {newPlayerSummary && onOpenNewPlayerGift && newPlayerSummary.totalShowcase > 0 && (
          <button
            type="button"
            className="w-full rounded-2xl overflow-hidden border border-purple-500/40 bg-gradient-to-br from-[#4a0e82] via-[#38136a] to-[#22104a] px-4 py-4 text-left active:scale-[0.99] transition-transform"
            onClick={onOpenNewPlayerGift}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                  {t('bonuses.newPlayer.title')}
                </span>
                <h2 className="text-white font-black leading-tight mt-0.5 font-display text-[1.3rem]">
                  {t('bonuses.newPlayer.entryTitle')}
                </h2>
                <p className="text-white/70 text-xs mt-0.5">
                  {t('bonuses.newPlayer.entrySub', { amount: '₱' + newPlayerSummary.totalShowcase.toLocaleString('en-PH') })}
                </p>
              </div>
              <span className="text-4xl">🎁</span>
            </div>
          </button>
        )}
      </div>

      <div className="mx-4 mt-4 mb-2 bg-secondary/50 rounded-xl px-4 py-3 border border-border">
        <p className="text-muted-foreground text-[11px] leading-relaxed text-center">{t('bonuses.disclaimer')}</p>
      </div>

      <TrialClaimModal
        open={trialModalOpen}
        amountPhp={promoConfig?.trial.amount ?? 0}
        onClose={() => setTrialModalOpen(false)}
      />
    </div>
  )
}
