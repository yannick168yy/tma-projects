import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Crown, History, ShieldCheck } from 'lucide-react'
import diamondImg from '@/assets/vip/diamond.webp'
import giftboxImg from '@/assets/vip/giftbox.webp'
import iconGift from '@/assets/vip/icon-gift.webp'
import iconRebate from '@/assets/vip/icon-rebate.webp'
import iconCrown from '@/assets/vip/icon-crown.webp'
import iconWeekly from '@/assets/vip/icon-weekly.webp'
import iconMonthly from '@/assets/vip/icon-monthly.webp'
import iconBday from '@/assets/vip/icon-bday.webp'
import iconLevelup from '@/assets/vip/icon-levelup.webp'
import iconCake from '@/assets/vip/icon-cake.webp'
import { fetchRebateConfig, fetchRebateProgress, claimRebate, type RebateConfig, type RebateProgress } from '@/api/rebate'
import { fetchVipProgress, fetchVipLevels, fetchVipRewards, claimVipRewards, type VipLevelConfig, type VipProgress, type VipReward } from '@/api/vip'
import { launchGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'
import { ApiError } from '@/api/client'
import { analytics } from '@/utils/analytics'
import type { VipTab } from '@/hooks/useFullPageOverlay'

const CATEGORY_ICONS: Record<string, string> = {
  slots: '🎰', live: '🎲', sports: '⚽', fishing: '🐟',
  poker: '♠️', bingo: '🎱', pinoy: '🐓', table: '🃏', crash: '🚀', other: '🎮',
}

const CATEGORY_ORDER = ['slots', 'live', 'sports', 'fishing', 'poker', 'bingo', 'pinoy', 'table', 'crash', 'other']
const VIP_TABS: VipTab[] = ['overview', 'cashback', 'benefits', 'records']
const VIP_GLASS_STYLE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(13, 13, 12, 0.97), rgba(8, 8, 7, 0.98)) padding-box, linear-gradient(128deg, rgba(255, 222, 134, 0.42) 0%, rgba(197, 144, 42, 0.12) 24%, rgba(60, 43, 17, 0.08) 48%, rgba(246, 196, 86, 0.32) 72%, rgba(44, 31, 12, 0.1) 100%) border-box',
  borderColor: 'transparent',
  boxShadow: '0 10px 26px rgba(0, 0, 0, 0.24)',
  backdropFilter: 'blur(8px)',
}
const VIP_INNER_GLASS_STYLE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(3, 3, 3, 0.34), rgba(0, 0, 0, 0.44)) padding-box, linear-gradient(128deg, rgba(255, 222, 134, 0.24) 0%, rgba(190, 143, 49, 0.08) 30%, rgba(50, 35, 13, 0.06) 58%, rgba(232, 181, 73, 0.18) 78%, rgba(30, 22, 10, 0.08) 100%) border-box',
  borderColor: 'transparent',
  boxShadow: 'none',
}

interface Props {
  initialTab?: VipTab
  onOpenGame: (url: string) => void
  onOpenCategory: (params: { title: string; sortCategory: string }) => void
  onOpenKycSetting?: () => void
}

function amtStr(currency: string, v: number) {
  return formatCurrencyAmount(currency, v)
}

function catKeyOf(cat: string) {
  return `cashback.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`
}

function categoryRank(cat: string) {
  const index = CATEGORY_ORDER.indexOf(cat)
  return index === -1 ? CATEGORY_ORDER.length : index
}

export default function VipPage({ initialTab = 'overview', onOpenGame, onOpenCategory, onOpenKycSetting }: Props) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const locale = useLocaleStore((s) => s.locale)
  const currency = activeCurrency

  const [activeTab, setActiveTab] = useState<VipTab>(initialTab)
  const [config, setConfig] = useState<RebateConfig | null>(null)
  const [progress, setProgress] = useState<RebateProgress | null>(null)
  const [vip, setVip] = useState<VipProgress | null>(null)
  const [levels, setLevels] = useState<VipLevelConfig[]>([])
  const [rewards, setRewards] = useState<VipReward[]>([])
  const [claimingCashback, setClaimingCashback] = useState(false)
  const [claimingVip, setClaimingVip] = useState(false)
  const [expandedTier, setExpandedTier] = useState<string | null>(null)
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  void launchingUuid

  useEffect(() => { setActiveTab(initialTab) }, [initialTab])

  useEffect(() => {
    fetchRebateConfig().then(setConfig).catch(() => null)
    fetchVipLevels().then((res) => setLevels(res.levels)).catch(() => null)
  }, [])

  const loadProgress = useCallback(async () => {
    if (!token) { setProgress(null); setVip(null); setRewards([]); return }
    try { setProgress(await fetchRebateProgress(currency)) } catch { setProgress(null) }
    try { setVip(await fetchVipProgress(currency)) } catch { setVip(null) }
  }, [token, currency])

  useEffect(() => { void loadProgress() }, [loadProgress])

  useEffect(() => {
    if (!token || activeTab !== 'records') return
    fetchVipRewards().then((res) => setRewards(res.rewards)).catch(() => setRewards([]))
  }, [token, activeTab])

  const VIP_TYPE_KEY: Record<string, string> = {
    negative_rebate: 'cashback.vipNegativeRebate',
    promotion: 'cashback.vipPromotion',
    weekly: 'cashback.vipWeekly',
    monthly: 'cashback.vipMonthly',
    birthday: 'cashback.vipBirthday',
  }

  async function onClaimCashback() {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (claimingCashback || !progress || progress.claimable <= 0) return
    setClaimingCashback(true)
    try {
      const res = await claimRebate(currency)
      analytics.rebateClaimSuccess(res.totalRebate, currency)
      alert(t('cashback.claimSuccess', { amount: amtStr(currency, res.totalRebate) }))
      await Promise.all([loadProgress(), useWalletStore.getState().refresh()])
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Claim failed')
    } finally { setClaimingCashback(false) }
  }

  async function onClaimVip() {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (claimingVip || !vip || vip.claimable <= 0) return
    setClaimingVip(true)
    try {
      const res = await claimVipRewards(currency)
      alert(t('cashback.vipClaimSuccess', { amount: amtStr(currency, res.totalAmount) }))
      await Promise.all([
        loadProgress(),
        fetchVipRewards().then((r) => setRewards(r.rewards)).catch(() => null),
        useWalletStore.getState().refresh(),
      ])
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Claim failed')
    } finally { setClaimingVip(false) }
  }

  async function onGameTap(uuid: string) {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (launchingUuid) return
    setLaunchingUuid(uuid)
    try {
      const { url } = await launchGame(uuid, 'mobile', activeCurrency)
      analytics.gameLaunch('real', uuid, activeCurrency, 'cashback')
      onOpenGame(url)
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Launch failed') }
    finally { setLaunchingUuid(null) }
  }

  const vipLevel = vip?.level ?? progress?.level ?? 1
  const currentLevel = levels.find((l) => l.level === vipLevel)
  const nextLevel = levels.find((l) => l.level === vipLevel + 1) ?? null
  const totalTurnover = vip?.totalTurnover ?? progress?.totalTurnover ?? 0
  const currentThreshold = vip?.currentThreshold ?? progress?.currentThreshold ?? currentLevel?.minTurnover ?? 0
  const nextThreshold = vip?.nextThreshold ?? progress?.nextThreshold ?? nextLevel?.minTurnover ?? null
  const remaining = nextThreshold != null ? Math.max(0, nextThreshold - totalTurnover) : 0
  const progressPct = nextThreshold != null
    ? Math.min(100, Math.max(0, (totalTurnover - currentThreshold) / Math.max(1, nextThreshold - currentThreshold) * 100))
    : 100

  const levelCards = config?.levels ?? []
  const userLevel = progress?.level ?? vipLevel
  const tiers = config ? Object.entries(config.featured ?? {}) : []
  const claimableBreakdown = useMemo(
    () => [...(progress?.claimableBreakdown ?? [])].sort((a, b) => categoryRank(a.gameCategory) - categoryRank(b.gameCategory) || a.gameCategory.localeCompare(b.gameCategory)),
    [progress?.claimableBreakdown],
  )
  const categoryBonusMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of claimableBreakdown) m.set(b.gameCategory, b.rebateAmount)
    return m
  }, [claimableBreakdown])

  const topTier = levelCards.length ? levelCards[levelCards.length - 1] : null
  const topBest = topTier
    ? topTier.rates.filter((r) => r.enabled && CATEGORY_ORDER.includes(r.gameCategory))
        .reduce<typeof topTier.rates[number] | null>((best, r) => (!best || r.ratePct > best.ratePct ? r : best), null)
    : null

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const activeCardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const c = scrollRef.current, a = activeCardRef.current
    if (c && a) c.scrollLeft = a.offsetLeft - (c.clientWidth - a.clientWidth) / 2
  }, [levelCards.length, userLevel, activeTab])

  const tierRate = (tier: string) => tier === 'elite' ? t('cashback.tierEliteRate') : t('cashback.tierProRate')

  function renderHero() {
    const nextLv = nextLevel?.level ?? (nextThreshold != null ? vipLevel + 1 : null)
    return (
      <section className="vip-page-header mx-4">
        <div className="flex h-9 items-center justify-between pl-11">
          <h1 className="font-display text-base font-normal uppercase tracking-[0.08em] text-amber-300">{t('vipPage.title')}</h1>
          <img src={iconCrown} alt="" className="h-10 w-10" />
        </div>
        <div className="relative mt-3 overflow-hidden rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <img src={diamondImg} alt="" className="pointer-events-none absolute -right-1 top-3 w-32 drop-shadow-[0_0_20px_rgba(180,140,60,0.3)]" />
          <div className="relative pr-32">
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#c9c9c7" className="flex-shrink-0">
                <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
              </svg>
              <span className="text-[11px] font-semibold text-[#d2d2d1]">{t('vipPage.locked')}</span>
              {nextLv != null && (
                <svg width="154" height="34" viewBox="0 0 154 34" className="ml-1 overflow-visible">
                  <defs>
                    <linearGradient id="vipArcLine" x1="0" y1="1" x2="1" y2="0">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0.9)" />
                    </linearGradient>
                    <radialGradient id="vipStarGlow">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </radialGradient>
                  </defs>
                  <path d="M8 19 Q 78 -1 142 8" stroke="url(#vipArcLine)" strokeWidth="1.4" fill="none" />
                  <circle cx="8" cy="19" r="2.4" fill="rgba(255,255,255,0.75)" />
                  <circle cx="142" cy="8" r="14" fill="url(#vipStarGlow)" />
                  <circle cx="142" cy="8" r="11" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="1.2" />
                  <path d="M142 1.5 L143.7 6.3 L148.5 8 L143.7 9.7 L142 14.5 L140.3 9.7 L135.5 8 L140.3 6.3 Z" fill="#ffffff" />
                  <text x="8" y="32" textAnchor="middle" fill="#ddddda" fontSize="10" fontWeight="600">Lv{vipLevel}</text>
                  <text x="142" y="27" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="600">Lv{nextLv}</text>
                </svg>
              )}
            </div>
            <div className="mt-1.5 flex items-end gap-2">
              <h2 className="text-[34px] font-bold leading-none text-white">VIP{vipLevel}</h2>
              {vip?.demoted && <span className="mb-1 rounded-full border border-rose-300/35 px-2 py-0.5 text-[10px] font-bold text-rose-200">{t('cashback.vipDemoted')}</span>}
            </div>
          </div>
          <div className="relative mt-3.5 grid grid-cols-[1fr_1.2fr] gap-2 pr-14">
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-[#c9c9c5]">{t('vipPage.growthValue')}</p>
              <p className="mt-1 truncate text-[15px] font-bold text-[#ffe082]">{amtStr(currency, totalTurnover)}</p>
            </div>
            <button type="button" onClick={() => setActiveTab('benefits')} className="min-w-0 text-left">
              <p className="text-[10px] font-medium text-[#c9c9c5]">{nextThreshold != null ? t('vipPage.toNextLevel') : t('cashback.maxLevel')}</p>
              <p className="mt-1 flex items-center gap-0.5 truncate text-[15px] font-bold text-[#e8bf4e]">
                {nextThreshold != null ? amtStr(currency, remaining) : 'MAX'}
                <ChevronRight size={14} className="flex-shrink-0 text-[#e8bf4e]/80" />
              </p>
            </button>
          </div>
          <div className="relative mt-3.5 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-[#e9c97e] to-[#cfa044] transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('benefits')}
              className="flex-shrink-0 rounded-lg bg-gradient-to-b from-[#e9c97e] to-[#cfa044] px-3 py-1.5 text-[11px] font-bold text-[#3a2a0d] active:scale-95"
            >
              {t('vipPage.upgradeGuide')}
            </button>
          </div>
        </div>
        <button
          type="button"
          disabled={claimingVip || !token || !vip || vip.claimable <= 0}
          onClick={() => void onClaimVip()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#e9c97e] to-[#cfa044] px-4 py-2.5 text-sm font-bold text-[#3a2a0d] shadow-[0_3px_14px_rgba(210,166,68,0.3)] disabled:opacity-45"
        >
          <GiftSolid size={17} />
          {claimingVip ? t('cashback.claiming') : t('vipPage.claimVip')}
        </button>
      </section>
    )
  }

  function renderTabs() {
    return (
      <div className="sticky top-0 z-10 bg-[#050403]/92 px-4 py-3 backdrop-blur">
        <div className="grid grid-cols-4 rounded-2xl border p-1" style={VIP_GLASS_STYLE}>
          {VIP_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-1 py-2 text-[11px] transition-colors ${activeTab === tab ? 'bg-gradient-to-b from-[#e9c97e] to-[#cfa044] font-bold text-[#3a2a0d]' : 'font-semibold text-[#d5d5d1]'}`}
            >
              {t(`vipPage.tabs.${tab}`)}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function renderOverview() {
    return (
      <div className="space-y-3 px-4 pb-8">
        <section
          role="button"
          tabIndex={0}
          onClick={() => void onClaimVip()}
          className="rounded-2xl border p-4"
          style={VIP_GLASS_STYLE}
        >
          <div className="flex items-center gap-2.5">
            <img src={iconGift} alt="" className="h-10 w-10 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-white">{t('vipPage.pendingRewards')}</h2>
              <p className="mt-1 truncate text-[11px] text-[#c9c9c5]">{t('cashback.vipEmpty')}</p>
            </div>
            <img src={giftboxImg} alt="" className="w-12 flex-shrink-0" />
            <ChevronRight size={16} className="flex-shrink-0 text-[#c9c9c5]" />
          </div>
          {vip && vip.claimableByType.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-amber-300/12 pt-3">
              {vip.claimableByType.map((it) => (
                <div key={it.type} className="flex items-center justify-between text-xs">
                  <span className="text-[#c9c9c5]">{t(VIP_TYPE_KEY[it.type] ?? 'cashback.vipTitle')}</span>
                  <span className="font-semibold text-[#f0b429]">+{amtStr(currency, it.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setActiveTab('cashback')} className="flex items-center justify-between gap-2 rounded-2xl border p-4 text-left" style={VIP_GLASS_STYLE}>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-white">{t('category.cashback')}</p>
              <p className="mt-1.5 truncate text-sm font-bold text-[#f0b429]">{amtStr(currency, token ? (progress?.claimable ?? 0) : 0)}</p>
            </div>
            <img src={iconRebate} alt="" className="h-11 w-11 flex-shrink-0" />
          </button>
          <button type="button" onClick={() => setActiveTab('benefits')} className="flex items-center justify-between gap-2 rounded-2xl border p-4 text-left" style={VIP_GLASS_STYLE}>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-white">{t('vipPage.benefits')}</p>
              <p className="mt-1.5 text-sm font-bold text-[#f0b429]">VIP{vipLevel}</p>
            </div>
            <img src={iconCrown} alt="" className="h-11 w-11 flex-shrink-0" />
          </button>
        </section>

        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <h2 className="text-sm font-semibold text-white">{t('vipPage.currentBenefits')}</h2>
          <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-4">
            <BenefitItem icon={iconWeekly} label={t('cashback.vipWeekly')} value={amtStr(currency, vip?.benefit?.weeklySalary ?? currentLevel?.weeklySalary ?? 0)} />
            <BenefitItem icon={iconMonthly} label={t('cashback.vipMonthly')} value={amtStr(currency, vip?.benefit?.monthlySalary ?? currentLevel?.monthlySalary ?? 0)} />
            <BenefitItem icon={iconBday} label={t('cashback.vipBirthday')} value={amtStr(currency, vip?.benefit?.birthdayBonus ?? currentLevel?.birthdayBonus ?? 0)} />
          </div>
          {vip != null && vip.retentionLine > 0 && (
            <p className="mt-4 text-[11px] text-[#c9c9c5]">{t('cashback.vipRetention', { have: amtStr(currency, vip.quarterTurnover), need: amtStr(currency, vip.retentionLine) })}</p>
          )}
          {vip?.prioritySupport && <p className="mt-2 text-[11px] font-bold text-[#f0b429]">{t('cashback.vipPrioritySupport')}</p>}
        </section>

        {nextLevel && (
          <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
            <h2 className="text-sm font-semibold text-white">{t('vipPage.nextUnlock', { level: nextLevel.level })}</h2>
            <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-4">
              <BenefitItem icon={iconLevelup} label={t('cashback.vipPromotion')} value={amtStr(currency, nextLevel.promotionBonus)} />
            </div>
          </section>
        )}

        {token && vip && (
          <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
            <h2 className="text-sm font-semibold text-white">{t('vipPage.birthdayTitle')}</h2>
            {vip.birthdaySet ? (
              <p className="mt-2 text-xs text-[#c9c9c5]">{t('cashback.vipBirthdaySet')}</p>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                <img src={iconCake} alt="" className="h-10 w-10 flex-shrink-0" />
                <p className="min-w-0 flex-1 text-xs leading-snug text-[#c9c9c5]">{t('cashback.vipBirthdayKyc')}</p>
                <button
                  type="button"
                  onClick={() => onOpenKycSetting?.()}
                  className="flex-shrink-0 rounded-lg bg-gradient-to-b from-[#e9c97e] to-[#cfa044] px-4 py-2 text-xs font-bold text-[#3a2a0d] active:scale-95"
                >
                  {t('cashback.vipBirthdayKycBtn')}
                </button>
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <h2 className="text-sm font-semibold text-white">{t('vipPage.overviewTipsTitle')}</h2>
          <div className="mt-3 grid gap-2">
            <CompactNote icon={iconLevelup} label={t('vipPage.overviewTipGrowth')} value={nextThreshold != null ? t('cashback.progressToNext', { remaining: amtStr(currency, remaining), level: nextLvOf(vipLevel) }) : t('cashback.maxLevel')} />
            <CompactNote icon={iconGift} label={t('vipPage.overviewTipClaim')} value={t('vipPage.overviewTipClaimDesc')} />
            <CompactNote icon={iconCrown} label={t('vipPage.overviewTipLevel')} value={t('vipPage.overviewTipLevelDesc')} />
          </div>
        </section>

        <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-[#9a9a96]">
          <ShieldCheck size={13} className="text-amber-300/50" />
          {t('vipPage.disclaimer')}
        </p>
      </div>
    )
  }

  function renderCashback() {
    return (
      <div className="space-y-3 px-4 pb-8">
        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-[#c9c9c5]">{t('cashback.totalBonus')}</p>
              <p className="mt-1 font-display text-2xl font-bold text-white">{amtStr(currency, token ? (progress?.claimable ?? 0) : 0)}</p>
            </div>
            <button
              type="button"
              onClick={() => void onClaimCashback()}
              disabled={claimingCashback || !token || !progress || progress.claimable <= 0}
              className="flex-shrink-0 rounded-xl bg-gradient-to-b from-[#e9c97e] to-[#cfa044] px-5 py-2.5 text-sm font-bold text-[#3a2a0d] disabled:opacity-45"
            >
              {claimingCashback ? t('cashback.claiming') : t('cashback.claimBtn')}
            </button>
          </div>
        </section>

        {token && claimableBreakdown.length > 0 && (
          <section className="space-y-1.5 rounded-2xl border px-4 py-3" style={VIP_GLASS_STYLE}>
            {claimableBreakdown.map((item) => (
              <div key={item.gameCategory} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-[#d5d5d1]">
                  <span>{CATEGORY_ICONS[item.gameCategory] ?? '🎮'}</span>
                  <span>{t(catKeyOf(item.gameCategory))}</span>
                  <span className="text-[10px] text-[#f0b429]">{item.ratePct}%</span>
                </span>
                <span className="font-semibold text-[#f0b429]">+{amtStr(currency, item.rebateAmount)}</span>
              </div>
            ))}
          </section>
        )}

        {tiers.length > 0 && (
          <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
            <h2 className="mb-3 text-sm font-semibold text-white">{t('cashback.cashbackGames')}</h2>
            <div className="space-y-3">
              {tiers.map(([tier, games]) => {
                const cover = games[0]?.coverUrl
                const expanded = expandedTier === tier
                return (
                  <div key={tier} className="overflow-hidden rounded-2xl border" style={VIP_INNER_GLASS_STYLE}>
                    <div className="flex items-center gap-3 p-3">
                      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border bg-black/35" style={{ borderColor: 'rgba(190, 143, 49, 0.28)' }}>
                        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl">🎰</div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">{t(tier === 'elite' ? 'cashback.tierElite' : 'cashback.tierPro')}</p>
                        <p className="mt-1 text-sm font-bold text-[#f0b429]">{tierRate(tier)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedTier(expanded ? null : tier)}
                        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#e9c97e] to-[#cfa044] py-1.5 pl-4 pr-1.5 text-[#3a2a0d]"
                      >
                        <span className="text-xs font-bold">{t('cashback.viewBtn')}</span>
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#5b3a0d]/55 px-1.5 text-[11px] font-bold text-amber-100">{games.length}</span>
                      </button>
                    </div>
                    {expanded && (
                      <div className="border-t px-3 pb-3 pt-3" style={{ borderColor: 'rgba(190, 143, 49, 0.18)' }}>
                        {games.length > 0 ? (
                          <div className="grid grid-cols-3 gap-2">
                            {games.map((g) => (
                              <button key={g.gameUuid} type="button" onClick={() => void onGameTap(g.gameUuid)} className="flex flex-col overflow-hidden rounded-xl bg-[#120f0a] active:scale-[0.98]">
                                <div className="aspect-square w-full bg-black/45">
                                  {g.coverUrl ? <img src={g.coverUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl">🎰</div>}
                                </div>
                                <p className="truncate px-1.5 py-1.5 text-[11px] font-bold text-white/95">{localizedGameName({ name: g.name ?? '', nameZh: g.nameZh }, locale)}</p>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="py-2 text-center text-xs text-muted-foreground">No games configured</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {levelCards.length > 0 && (
          <section className="rounded-2xl border py-4" style={VIP_GLASS_STYLE}>
            <div className="mb-3 flex items-center justify-between px-4">
              <h2 className="text-sm font-semibold text-white">{t('cashback.rateTable')}</h2>
              {token && progress && <span className="rounded-full bg-gradient-to-b from-[#e9c97e] to-[#cfa044] px-3 py-1 text-xs font-bold text-[#3a2a0d]">{t('cashback.levelTag', { level: progress.level })}</span>}
            </div>

            {topBest && (
              <div className="mx-4 mb-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5" style={VIP_INNER_GLASS_STYLE}>
                <Crown size={18} className="flex-shrink-0 text-amber-300" />
                <p className="text-[12px] font-bold leading-snug text-amber-100">
                  {t('cashback.topTierBanner', {
                    cat: t(catKeyOf(topBest.gameCategory)),
                    rate: topBest.ratePct,
                    amount: topBest.maxBonus > 0 ? amtStr(currency, topBest.maxBonus) : t('cashback.unlimited'),
                  })}
                </p>
              </div>
            )}

            {token && progress && (
              <div className="mx-4 mb-3 rounded-2xl border px-4 py-3" style={VIP_INNER_GLASS_STYLE}>
                <p className="text-[11px] text-[#c9c9c5]">{t('cashback.totalTurnover')}</p>
                <p className="mt-0.5 font-display text-2xl font-bold text-white">{amtStr(currency, progress.totalTurnover)}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#e9c97e] to-[#cfa044]" style={{ width: `${progressPct}%` }} /></div>
                <p className="mt-1.5 text-[11px] text-amber-300/80">{progress.nextThreshold != null ? t('cashback.progressToNext', { remaining: amtStr(currency, remaining), level: progress.nextLevel }) : t('cashback.maxLevel')}</p>
              </div>
            )}

            <div ref={scrollRef} className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 hide-scrollbar">
              {levelCards.map((lc) => {
                const isCurrent = token && lc.level === userLevel
                const isMax = lc.level === (levelCards[levelCards.length - 1]?.level ?? lc.level)
                const catRates = CATEGORY_ORDER.map((cat) => lc.rates.find((r) => r.gameCategory === cat && r.enabled)).filter((r): r is NonNullable<typeof r> => Boolean(r))
                const toUnlock = progress ? Math.max(0, lc.minTurnover - progress.totalTurnover) : lc.minTurnover
                return (
                  <div key={lc.level} ref={isCurrent ? activeCardRef : undefined} className="flex w-[82%] max-w-[330px] shrink-0 snap-center flex-col rounded-2xl border p-4" style={isMax || isCurrent ? VIP_GLASS_STYLE : VIP_INNER_GLASS_STYLE}>
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`font-display text-xl font-black ${isMax ? 'text-amber-300' : 'text-amber-50'}`}>{t('cashback.levelTag', { level: lc.level })}</span>
                          {isCurrent && <span className="rounded-full bg-amber-300/90 px-2 py-0.5 text-[10px] font-black text-[#1b1204]">{t('cashback.levelCurrent')}</span>}
                        </div>
                        <p className="mt-0.5 text-[11px] text-amber-100/55">{lc.minTurnover > 0 ? t('cashback.levelReq', { amount: amtStr(currency, lc.minTurnover) }) : t('cashback.levelEntry')}</p>
                      </div>
                      {isMax && <span className="rounded-md bg-gradient-to-r from-amber-300 to-yellow-500 px-2 py-1 text-[10px] font-black text-[#1b1204]">MAX</span>}
                    </div>

                    <div className="flex-1 space-y-2">
                      {catRates.map((r) => {
                        const bonus = isCurrent ? (categoryBonusMap.get(r.gameCategory) ?? 0) : 0
                        return (
                          <button key={r.gameCategory} type="button" onClick={() => onOpenCategory({ title: t(catKeyOf(r.gameCategory)), sortCategory: r.gameCategory })} className="flex w-full items-center gap-2 active:opacity-70">
                            <span className="flex-shrink-0 text-xl leading-none">{CATEGORY_ICONS[r.gameCategory] ?? '🎮'}</span>
                            <span className="w-16 truncate text-left text-sm font-semibold text-amber-50/90">{t(catKeyOf(r.gameCategory))}</span>
                            <span className="flex-1 text-right leading-tight">
                              <span className="block text-sm font-bold text-amber-300">+{amtStr(currency, bonus)}</span>
                              <span className="block text-[9px] text-amber-100/45">{t('cashback.maxShort')} {r.maxBonus > 0 ? amtStr(currency, r.maxBonus) : t('cashback.unlimited')}</span>
                            </span>
                            <span className="w-10 text-right text-sm font-black text-amber-300/90">{r.ratePct}%</span>
                          </button>
                        )
                      })}
                    </div>

                    <div className={`mt-3 rounded-lg py-2 text-center text-xs font-black ${isCurrent || (progress && lc.level < userLevel) ? 'bg-[#5b3a0d]/55 text-amber-50' : isMax ? 'bg-gradient-to-r from-amber-300 to-yellow-500 text-[#1b1204]' : 'bg-[#1c1408] text-amber-200'}`}>
                      {isCurrent ? t('cashback.levelCurrent') : progress && lc.level < userLevel ? t('cashback.unlocked') : t('cashback.toUnlock', { amount: amtStr(currency, toUnlock) })}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-1 px-4 text-center text-[10px] text-amber-100/35">{t('cashback.creditedTomorrow')} · {t('cashback.unsettledNotCounted')}</p>
          </section>
        )}

        <FooterPanel
          title={t('vipPage.cashbackFooterTitle')}
          items={[
            t('vipPage.cashbackFooterItem1'),
            t('vipPage.cashbackFooterItem2'),
            t('vipPage.cashbackFooterItem3'),
          ]}
        />
      </div>
    )
  }

  function renderBenefits() {
    const sortedLevels = levels.length ? levels : currentLevel ? [currentLevel] : []
    return (
      <div className="px-4 pb-8">
        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <h2 className="text-sm font-semibold text-white">{t('vipPage.levelBenefits')}</h2>
          <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 hide-scrollbar">
            {sortedLevels.map((lv) => {
              const isCurrent = lv.level === vipLevel
              return (
                <div key={lv.level} className="w-[78%] max-w-[300px] shrink-0 snap-center rounded-2xl border p-4" style={isCurrent ? VIP_GLASS_STYLE : VIP_INNER_GLASS_STYLE}>
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <p className="font-display text-2xl font-black text-amber-100">VIP{lv.level}</p>
                      <p className="text-[11px] text-amber-100/55">{lv.minTurnover > 0 ? t('cashback.levelReq', { amount: amtStr(currency, lv.minTurnover) }) : t('cashback.levelEntry')}</p>
                    </div>
                    {isCurrent && <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black text-[#241604]">{t('cashback.levelCurrent')}</span>}
                  </div>
                  <div className="space-y-2 text-xs">
                    <BenefitLine label={t('cashback.vipPromotion')} value={amtStr(currency, lv.promotionBonus)} />
                    <BenefitLine label={t('cashback.vipWeekly')} value={amtStr(currency, lv.weeklySalary)} />
                    <BenefitLine label={t('cashback.vipMonthly')} value={amtStr(currency, lv.monthlySalary)} />
                    <BenefitLine label={t('cashback.vipBirthday')} value={amtStr(currency, lv.birthdayBonus)} />
                    <BenefitLine label={t('vipPage.retentionLine')} value={amtStr(currency, lv.retentionLine)} />
                    <BenefitLine label={t('vipPage.withdrawLimit')} value={`${amtStr(currency, lv.withdrawDailyLimit)} / ${lv.withdrawDailyCount}x`} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
        <FooterPanel
          className="mt-3"
          title={t('vipPage.benefitsFooterTitle')}
          items={[
            t('vipPage.benefitsFooterItem1'),
            t('vipPage.benefitsFooterItem2'),
            t('vipPage.benefitsFooterItem3'),
          ]}
        />
      </div>
    )
  }

  function renderRecords() {
    return (
      <div className="px-4 pb-8">
        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <div className="mb-3 flex items-center gap-2">
            <History size={17} className="text-amber-300" />
            <h2 className="text-sm font-semibold text-white">{t('vipPage.recordsTitle')}</h2>
          </div>
          {!token ? (
            <p className="text-xs text-amber-100/45">{t('auth.signInProfile')}</p>
          ) : rewards.length === 0 ? (
            <p className="text-xs text-amber-100/45">{t('vipPage.noRecords')}</p>
          ) : (
            <div className="space-y-2">
              {rewards.map((item) => (
                <div key={item.id} className="rounded-xl border px-3 py-2" style={VIP_INNER_GLASS_STYLE}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-amber-50">{t(VIP_TYPE_KEY[item.type] ?? 'cashback.vipTitle')} · VIP{item.level}</span>
                    <span className="text-xs font-black text-amber-300">{amtStr(item.currencyCode, item.amount)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-amber-100/45">
                    <span>{item.periodKey}</span>
                    <span>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <FooterPanel
          className="mt-3"
          title={t('vipPage.recordsFooterTitle')}
          items={[
            t('vipPage.recordsFooterItem1'),
            t('vipPage.recordsFooterItem2'),
            t('vipPage.recordsFooterItem3'),
          ]}
        />
      </div>
    )
  }

  return (
    <div className="page-main min-h-screen pb-6" style={{ background: 'linear-gradient(180deg,#050403 0%,#080603 42%,#040302 100%)' }}>
      {renderHero()}
      {renderTabs()}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'cashback' && renderCashback()}
      {activeTab === 'benefits' && renderBenefits()}
      {activeTab === 'records' && renderRecords()}
    </div>
  )
}

function nextLvOf(level: number) {
  return level + 1
}

function GiftSolid({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#3a2a0d">
      <path d="M12 7c-2.1 0-4.4-1-4.4-2.8C7.6 2.9 8.8 2 10.1 2c.8 0 1.5.4 1.9 1.1.4-.7 1.1-1.1 1.9-1.1 1.3 0 2.5.9 2.5 2.2C16.4 6 14.1 7 12 7Z" />
      <path d="M3 9.4C3 8.6 3.7 8 4.5 8H11v3.5H3V9.4ZM13 11.5V8h6.5c.8 0 1.5.6 1.5 1.4v2.1h-8Z" />
      <path d="M4 13h7v8H6a2 2 0 0 1-2-2v-6ZM13 21v-8h7v6a2 2 0 0 1-2 2h-5Z" />
    </svg>
  )
}

function BenefitItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={icon} alt="" className="h-11 w-11 flex-shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-[#c9c9c5]">{label}</p>
        <p className="mt-0.5 truncate text-sm font-bold text-[#f0b429]">{value}</p>
      </div>
    </div>
  )
}

function BenefitLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-amber-50/62">{label}</span>
      <span className="font-bold text-amber-300">{value}</span>
    </div>
  )
}

function CompactNote({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5" style={VIP_INNER_GLASS_STYLE}>
      <img src={icon} alt="" className="h-8 w-8 flex-shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-white">{label}</p>
        <p className="mt-0.5 truncate text-[11px] text-[#c9c9c5]">{value}</p>
      </div>
    </div>
  )
}

function FooterPanel({ title, items, className = '' }: { title: string; items: string[]; className?: string }) {
  return (
    <section className={`rounded-2xl border p-4 ${className}`} style={VIP_GLASS_STYLE}>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={item} className="flex gap-2.5 text-[11px] leading-snug text-[#c9c9c5]">
            <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#2b261b] text-[10px] font-bold text-[#f0b429]">{index + 1}</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
