import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, History, ShieldCheck } from 'lucide-react'
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
import { fetchRebateProgress, type RebateProgress } from '@/api/rebate'
import { fetchVipProgress, fetchVipLevels, fetchVipRewards, claimVipRewards, fetchLossRebateStatus, type VipLevelConfig, type VipProgress, type VipReward, type LossRebateStatus } from '@/api/vip'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { ApiError } from '@/api/client'
import type { VipTab } from '@/hooks/useFullPageOverlay'

const VIP_TABS: VipTab[] = ['overview', 'lossrebate', 'benefits', 'records']
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
  onOpenKycSetting?: () => void
  onOpenCashback?: () => void
}

function amtStr(currency: string, v: number) {
  return formatCurrencyAmount(currency, v)
}

export default function VipPage({ initialTab = 'overview', onOpenKycSetting, onOpenCashback }: Props) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const currency = activeCurrency

  const [activeTab, setActiveTab] = useState<VipTab>(initialTab)
  const [progress, setProgress] = useState<RebateProgress | null>(null)
  const [vip, setVip] = useState<VipProgress | null>(null)
  const [levels, setLevels] = useState<VipLevelConfig[]>([])
  const [rewards, setRewards] = useState<VipReward[]>([])
  const [lossStatus, setLossStatus] = useState<LossRebateStatus | null>(null)
  const [claimingVip, setClaimingVip] = useState(false)
  const benefitsScrollRef = useRef<HTMLDivElement>(null)
  const currentCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setActiveTab(initialTab) }, [initialTab])

  useEffect(() => {
    fetchVipLevels(currency).then((res) => setLevels(res.levels)).catch(() => null)
  }, [currency])

  const loadProgress = useCallback(async () => {
    if (!token) { setProgress(null); setVip(null); setRewards([]); setLossStatus(null); return }
    try { setProgress(await fetchRebateProgress(currency)) } catch { setProgress(null) }
    try { setVip(await fetchVipProgress(currency)) } catch { setVip(null) }
    try { setLossStatus(await fetchLossRebateStatus(currency)) } catch { setLossStatus(null) }
  }, [token, currency])

  useEffect(() => { void loadProgress() }, [loadProgress])

  useEffect(() => {
    if (!token || activeTab !== 'records') return
    fetchVipRewards(currency).then((res) => setRewards(res.rewards)).catch(() => setRewards([]))
  }, [token, activeTab, currency])

  const VIP_TYPE_KEY: Record<string, string> = {
    negative_rebate: 'cashback.vipNegativeRebate',
    promotion: 'cashback.vipPromotion',
    weekly: 'cashback.vipWeekly',
    monthly: 'cashback.vipMonthly',
    birthday: 'cashback.vipBirthday',
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
        fetchVipRewards(currency).then((r) => setRewards(r.rewards)).catch(() => null),
        useWalletStore.getState().refresh(),
      ])
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Claim failed')
    } finally { setClaimingVip(false) }
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

  // 进入 benefits tab 时把当前等级卡片居中，默认展示用户所处等级
  useEffect(() => {
    if (activeTab !== 'benefits') return
    const c = benefitsScrollRef.current, card = currentCardRef.current
    if (!c || !card) return
    c.scrollTo({ left: card.offsetLeft - (c.clientWidth - card.clientWidth) / 2, behavior: 'auto' })
  }, [activeTab, levels, vipLevel])

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
          <button type="button" onClick={() => onOpenCashback?.()} className="flex items-center justify-between gap-2 rounded-2xl border p-4 text-left" style={VIP_GLASS_STYLE}>
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

  function renderLossRebate() {
    const s = lossStatus
    const rate = s?.ratePct ?? 5
    const canClaim = (s?.pendingClaimable ?? 0) > 0
    const settled = s?.todaySettled ?? 0
    const claimed = s?.todayClaimed ?? 0
    // 待结算预计 = 今日预计返水 − 今日已结算(含已领/待领)，避免把已结算部分重复算进「还能返」
    const remainingEstimate = Math.max(0, Math.round(((s?.potentialRebate ?? 0) - settled) * 100) / 100)
    const heroVal = canClaim ? (s?.pendingClaimable ?? 0) : remainingEstimate
    const reasonMsg = !s || !s.enabled
      ? t('lossRebate.introBody', { rate })
      : canClaim
        ? t('lossRebate.status.pending', { amt: amtStr(currency, s.pendingClaimable) })
        : s.netLoss <= 0
          ? t('lossRebate.status.noLoss')
          : s.reason === 'need_deposit'
            ? t('lossRebate.status.needDeposit', { days: s.windowDays, min: amtStr(currency, s.minDeposit), dep: amtStr(currency, s.windowDeposit) })
            : remainingEstimate > 0
              ? t('lossRebate.status.pendingSettle')
              : t('lossRebate.status.settledAll')
    return (
      <div className="space-y-3 px-4 pb-8">
        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <p className="text-[11px] font-medium text-[#c9c9c5]">{canClaim ? t('lossRebate.status.pendingLabel') : t('lossRebate.status.remaining')}</p>
          <p className="mt-1 font-display text-3xl font-black text-amber-200">{amtStr(currency, heroVal)}</p>
          <div className="mt-2.5 space-y-1.5 rounded-xl border px-3 py-2.5 text-xs" style={VIP_INNER_GLASS_STYLE}>
            <div className="flex items-center justify-between">
              <span className="text-[#c9c9c5]">{t('lossRebate.status.netLoss')} · {rate}%</span>
              <span className="font-bold text-white">{amtStr(currency, s?.netLoss ?? 0)}</span>
            </div>
            {claimed > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[#c9c9c5]">{t('lossRebate.status.claimedToday')}</span>
                <span className="font-bold text-emerald-300">{amtStr(currency, claimed)}</span>
              </div>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-amber-100/70">{reasonMsg}</p>
          <button
            type="button"
            onClick={() => void onClaimVip()}
            disabled={claimingVip || !canClaim}
            className="mt-3 w-full rounded-xl bg-gradient-to-b from-[#e9c97e] to-[#cfa044] py-3 text-sm font-black text-[#3a2a0d] disabled:opacity-45"
          >
            {claimingVip ? t('cashback.claiming') : canClaim ? t('lossRebate.claimNow', { amt: amtStr(currency, s?.pendingClaimable ?? 0) }) : t('lossRebate.noClaim')}
          </button>
          <button type="button" onClick={() => setActiveTab('records')} className="mt-2 flex w-full items-center justify-center gap-1 text-[11px] font-semibold text-amber-300/80 active:opacity-70">
            {t('lossRebate.viewHistory')} <ChevronRight size={12} />
          </button>
        </section>

        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <h2 className="mb-1.5 text-sm font-semibold text-white">{t('lossRebate.introTitle')}</h2>
          <p className="text-[12px] leading-relaxed text-[#c9c9c5]">{t('lossRebate.introBody', { rate })}</p>
        </section>

        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <h2 className="mb-2 text-sm font-semibold text-white">{t('lossRebate.howTitle')}</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-[#c9c9c5]">
            <li>{t('lossRebate.how1')}</li>
            <li>{t('lossRebate.how2', { rate })}</li>
            <li>{t('lossRebate.how3')}</li>
          </ul>
        </section>

        <section className="rounded-2xl border p-4" style={VIP_GLASS_STYLE}>
          <h2 className="mb-2 text-sm font-semibold text-white">{t('lossRebate.condTitle')}</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-[#c9c9c5]">
            <li>{t('lossRebate.cond1', { days: s?.windowDays ?? 7, min: amtStr(currency, s?.minDeposit ?? 0) })}</li>
            <li>{t('lossRebate.cond2')}</li>
            <li>{t('lossRebate.gamesBody')}</li>
          </ul>
        </section>

        <p className="px-1 text-center text-[10px] leading-relaxed text-white/40">{t('lossRebate.disclaimer')}</p>
      </div>
    )
  }

  function renderBenefits() {
    const sortedLevels = levels.length ? levels : currentLevel ? [currentLevel] : []
    return (
      <div className="px-4 pb-8">
        <h2 className="mb-3 px-1 text-sm font-semibold text-white">{t('vipPage.levelBenefits')}</h2>
        <div ref={benefitsScrollRef} className="flex snap-x snap-mandatory gap-3.5 overflow-x-auto pb-2 hide-scrollbar">
          {sortedLevels.map((lv) => {
            const isCurrent = lv.level === vipLevel
            const isMax = lv.level === (sortedLevels[sortedLevels.length - 1]?.level ?? lv.level)
            return (
              <div key={lv.level} ref={isCurrent ? currentCardRef : undefined} className="flex min-h-[430px] w-[78%] max-w-[312px] shrink-0 snap-center flex-col overflow-hidden rounded-[26px] border" style={isCurrent ? VIP_GLASS_STYLE : VIP_INNER_GLASS_STYLE}>
                <div className="relative flex items-center gap-3 border-b border-amber-300/14 px-5 py-5">
                  <img src={iconCrown} alt="" className="h-16 w-16 flex-shrink-0 drop-shadow-[0_2px_8px_rgba(180,140,60,0.45)]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-display text-[34px] font-black leading-none text-amber-100">VIP {lv.level}</p>
                      {isCurrent && <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black text-[#241604]">{t('cashback.levelCurrent')}</span>}
                      {isMax && !isCurrent && <span className="rounded-md bg-gradient-to-r from-amber-300 to-yellow-500 px-2 py-0.5 text-[10px] font-black text-[#1b1204]">MAX</span>}
                    </div>
                    <p className="mt-1.5 text-[11px] text-amber-100/55">{lv.minTurnover > 0 ? t('cashback.levelReq', { amount: amtStr(currency, lv.minTurnover) }) : t('cashback.levelEntry')}</p>
                  </div>
                </div>
                <div className="flex flex-1 flex-col justify-center gap-5 px-5 py-6">
                  <BenefitItem icon={iconLevelup} label={t('cashback.vipPromotion')} value={amtStr(currency, lv.promotionBonus)} />
                  <BenefitItem icon={iconWeekly} label={t('cashback.vipWeekly')} value={amtStr(currency, lv.weeklySalary)} />
                  <BenefitItem icon={iconMonthly} label={t('cashback.vipMonthly')} value={amtStr(currency, lv.monthlySalary)} />
                  <BenefitItem icon={iconBday} label={t('cashback.vipBirthday')} value={amtStr(currency, lv.birthdayBonus)} />
                </div>
                <div className="space-y-2.5 border-t border-amber-300/14 px-5 py-5 text-[13px]">
                  <BenefitLine label={t('vipPage.retentionLine')} value={amtStr(currency, lv.retentionLine)} />
                  <BenefitLine label={t('vipPage.withdrawLimit')} value={`${amtStr(currency, lv.withdrawDailyLimit)} / ${lv.withdrawDailyCount}x`} />
                </div>
              </div>
            )
          })}
        </div>
        <FooterPanel
          className="mt-4"
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
      {activeTab === 'lossrebate' && renderLossRebate()}
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
