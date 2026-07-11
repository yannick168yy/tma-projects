import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { fetchRebateConfig, fetchRebateProgress, claimRebate, type RebateConfig, type RebateProgress } from '@/api/rebate'
import { fetchVipProgress, claimVipRewards, type VipProgress } from '@/api/vip'
import { launchGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'
import { ApiError } from '@/api/client'
import { analytics } from '@/utils/analytics'
import cashbackHero from '@/assets/home/promos/cashback-hero-2.webp'

const CATEGORY_ICONS: Record<string, string> = {
  slots: '🎰', live: '🎲', sports: '⚽', fishing: '🐟',
  poker: '♠️', bingo: '🎱', pinoy: '🐓', table: '🃏', crash: '🚀', other: '🎮',
}

const CATEGORY_ORDER = ['slots', 'live', 'sports', 'fishing', 'poker', 'bingo', 'pinoy', 'table', 'crash', 'other']
const categoryRank = (cat: string) => {
  const index = CATEGORY_ORDER.indexOf(cat)
  return index === -1 ? CATEGORY_ORDER.length : index
}

interface Props {
  onOpenGame: (url: string) => void
  onOpenCategory: (params: { title: string; sortCategory: string }) => void
  onOpenVipCenter?: () => void
}

function amtStr(currency: string, v: number) {
  return formatCurrencyAmount(currency, v)
}

function catKeyOf(cat: string) {
  return `cashback.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`
}

export default function RebatePage({ onOpenGame, onOpenCategory, onOpenVipCenter }: Props) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const locale = useLocaleStore((s) => s.locale)
  const currency = activeCurrency

  const [config, setConfig] = useState<RebateConfig | null>(null)
  const [progress, setProgress] = useState<RebateProgress | null>(null)
  const [vip, setVip] = useState<VipProgress | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimingVip, setClaimingVip] = useState(false)
  const [expandedTier, setExpandedTier] = useState<string | null>(null)
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  void launchingUuid // 保留，后续可扩展 loading 状态展示

  useEffect(() => {
    fetchRebateConfig().then(setConfig).catch(() => null)
  }, [])

  const loadProgress = useCallback(async () => {
    if (!token) { setProgress(null); setVip(null); return }
    try { setProgress(await fetchRebateProgress(currency)) } catch { setProgress(null) }
    try { setVip(await fetchVipProgress(currency)) } catch { setVip(null) }
  }, [token, currency])

  useEffect(() => { void loadProgress() }, [loadProgress])

  async function onClaim() {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (claiming || !progress || progress.claimable <= 0) return
    setClaiming(true)
    try {
      const res = await claimRebate(currency)
      analytics.rebateClaimSuccess(res.totalRebate, currency)
      alert(t('cashback.claimSuccess', { amount: amtStr(currency, res.totalRebate) }))
      await Promise.all([loadProgress(), useWalletStore.getState().refresh()])
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Claim failed')
    } finally { setClaiming(false) }
  }


  async function onClaimVip() {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (claimingVip || !vip || vip.claimable <= 0) return
    setClaimingVip(true)
    try {
      const res = await claimVipRewards(currency)
      alert(t('cashback.vipClaimSuccess', { amount: amtStr(currency, res.totalAmount) }))
      await Promise.all([loadProgress(), useWalletStore.getState().refresh()])
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Claim failed')
    } finally { setClaimingVip(false) }
  }

  const VIP_TYPE_KEY: Record<string, string> = {
    negative_rebate: 'cashback.vipNegativeRebate',
    promotion: 'cashback.vipPromotion',
    weekly: 'cashback.vipWeekly',
    monthly: 'cashback.vipMonthly',
    birthday: 'cashback.vipBirthday',
  }

  function toggleTier(tier: string) {
    setExpandedTier((prev) => prev === tier ? null : tier)
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

  const levelCards = config?.levels ?? []
  const userLevel = progress?.level ?? 1

  const claimableBreakdown = useMemo(
    () => [...(progress?.claimableBreakdown ?? [])].sort((a, b) => categoryRank(a.gameCategory) - categoryRank(b.gameCategory) || a.gameCategory.localeCompare(b.gameCategory)),
    [progress?.claimableBreakdown],
  )

  const categoryBonusMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of claimableBreakdown) m.set(b.gameCategory, b.rebateAmount)
    return m
  }, [claimableBreakdown])

  // 顶部 banner：取最高等级费率最高的大类
  const topTier = levelCards.length ? levelCards[levelCards.length - 1] : null
  const topBest = topTier
    ? topTier.rates.filter((r) => r.enabled && CATEGORY_ORDER.includes(r.gameCategory))
        .reduce<typeof topTier.rates[number] | null>((best, r) => (!best || r.ratePct > best.ratePct ? r : best), null)
    : null

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const activeCardRef = useRef<HTMLDivElement | null>(null)
  // 默认把当前等级卡片居中
  useEffect(() => {
    const c = scrollRef.current, a = activeCardRef.current
    if (c && a) c.scrollLeft = a.offsetLeft - (c.clientWidth - a.clientWidth) / 2
  }, [levelCards.length, userLevel])

  const remaining = progress && progress.nextThreshold != null
    ? Math.max(0, progress.nextThreshold - progress.totalTurnover) : 0
  const progressPct = progress && progress.nextThreshold != null
    ? Math.min(100, Math.max(0, (progress.totalTurnover - progress.currentThreshold) / Math.max(1, progress.nextThreshold - progress.currentThreshold) * 100))
    : 100
  const tiers = config ? Object.entries(config.featured ?? {}) : []

  const tierRate = (tier: string) => tier === 'elite' ? t('cashback.tierEliteRate') : t('cashback.tierProRate')

  return (
    <div
      className="page-main min-h-screen pb-8"
      style={{ background: 'linear-gradient(180deg,#050403 0%,#080603 42%,#040302 100%)' }}
    >
      <img
        src={cashbackHero}
        alt={t('cashback.pageTitle')}
        className="block w-full select-none"
        draggable={false}
      />

      <div className="space-y-3 px-4 pt-4">
      <div className="rounded-2xl border border-white/5 bg-[#161512] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-[#c9c9c5]">{t('cashback.totalBonus')}</p>
            <p className="mt-1 font-display text-2xl font-bold text-white">
              {amtStr(currency, token ? (progress?.claimable ?? 0) : 0)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onClaim()}
            disabled={claiming || !token || !progress || progress.claimable <= 0}
            className="flex-shrink-0 rounded-xl bg-gradient-to-b from-[#e9c97e] to-[#cfa044] px-5 py-2.5 text-sm font-bold text-[#3a2a0d] active:opacity-80 disabled:opacity-45"
          >
            {claiming ? t('cashback.claiming') : t('cashback.claimBtn')}
          </button>
        </div>
      </div>

      {token && claimableBreakdown.length > 0 && (
        <div className="space-y-1.5 rounded-2xl border border-white/5 bg-[#161512] px-4 py-3">
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
        </div>
      )}

      {/* VIP 成长权益：负盈利返水 + 晋级礼金（登录可见，单独领取） */}
      {token && (
        <div className="rounded-2xl border border-white/5 bg-[#161512] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-white">👑 {t('cashback.vipTitle')}</p>
              <p className="mt-1 text-[11px] text-[#c9c9c5]">{t('cashback.vipSubtitle')}</p>
            </div>
            <button
              type="button"
              onClick={onOpenVipCenter}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 text-[#f0b429] active:scale-95"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[11px] text-[#c9c9c5]">{t('vipPage.vipClaimable')}</p>
              <p className="mt-0.5 truncate text-sm font-bold text-[#f0b429]">{amtStr(currency, vip?.claimable ?? 0)}</p>
            </div>
            {vip && vip.claimable > 0 && (
              <button
                type="button"
                onClick={() => void onClaimVip()}
                disabled={claimingVip}
                className="flex-shrink-0 rounded-lg bg-gradient-to-b from-[#e9c97e] to-[#cfa044] px-4 py-2 text-xs font-bold text-[#3a2a0d] active:opacity-80 disabled:opacity-45"
              >
                {claimingVip ? t('cashback.claiming') : t('cashback.claimBtn')}
              </button>
            )}
          </div>

          {vip && vip.claimableByType.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {vip.claimableByType.map((it) => (
                <div key={it.type} className="flex items-center justify-between text-xs">
                  <span className="text-[#c9c9c5]">{t(VIP_TYPE_KEY[it.type] ?? 'cashback.vipTitle')}</span>
                  <span className="font-semibold text-[#f0b429]">+{amtStr(currency, it.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 space-y-1 border-t border-white/5 pt-3">
            {vip?.benefit && vip.benefit.negativeRebatePct > 0 && (
              <p className="text-[11px] text-[#c9c9c5]">{t('cashback.vipCurrentRate', { rate: vip.benefit.negativeRebatePct })}</p>
            )}
            {vip && vip.retentionLine > 0 && (
              <p className="text-[11px] text-[#c9c9c5]">
                {t('cashback.vipRetention', { have: amtStr(currency, vip.quarterTurnover), need: amtStr(currency, vip.retentionLine) })}
              </p>
            )}
            {vip?.demoted && (
              <p className="text-[11px] text-rose-300/80">{t('cashback.vipDemoted')}</p>
            )}
            {vip?.prioritySupport && (
              <p className="text-[11px] font-bold text-[#f0b429]">👑 {t('cashback.vipPrioritySupport')}</p>
            )}
          </div>

        </div>
      )}

      {/* CASHBACK GAMES */}
      {tiers.length > 0 && (
        <div className="rounded-2xl border border-white/5 bg-[#161512] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">{t('cashback.cashbackGames')}</h3>
          <div className="space-y-3">
            {tiers.map(([tier, games]) => {
              const cover = games[0]?.coverUrl
              const expanded = expandedTier === tier
              return (
                <div key={tier} className="overflow-hidden rounded-2xl border border-white/5 bg-black/20">
                  <div className="flex items-center gap-3 p-3">
                    <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-white/5 bg-black/35">
                      {cover
                        ? <img src={cover} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-2xl">🎰</div>
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">
                        {t(tier === 'elite' ? 'cashback.tierElite' : 'cashback.tierPro')}
                      </p>
                      <div className="flex gap-5 mt-1">
                        <div>
                          <p className="text-[10px] text-[#c9c9c5]">{t('cashback.cashbackRate')}</p>
                          <p className="text-sm font-bold text-[#f0b429]">{tierRate(tier)}</p>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleTier(tier)}
                      className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#e9c97e] to-[#cfa044] py-1.5 pl-4 pr-1.5 text-[#3a2a0d] active:opacity-80"
                    >
                      <span className="font-bold text-xs">{t('cashback.viewBtn')}</span>
                      <span className="bg-[#5b3a0d]/55 text-amber-100 text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                        {games.length}
                      </span>
                    </button>
                  </div>
                  {expanded && (
                    <div className="border-t border-white/5 px-3 pb-3 pt-3">
                      {games.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                          {games.map((g) => (
                            <button
                              key={g.gameUuid}
                              type="button"
                              onClick={() => void onGameTap(g.gameUuid)}
                              className="flex flex-col rounded-xl overflow-hidden bg-[#120f0a] active:scale-[0.98] transition-transform"
                            >
                              <div className="aspect-square w-full bg-black/45">
                                {g.coverUrl
                                  ? <img src={g.coverUrl} alt="" className="w-full h-full object-cover" />
                                  : <div className="w-full h-full flex items-center justify-center text-2xl">🎰</div>
                                }
                              </div>
                              <p className="text-[11px] font-bold text-white/95 truncate px-1.5 py-1.5">
                                {localizedGameName({ name: g.name ?? '', nameZh: g.nameZh }, locale)}
                              </p>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-xs text-center py-2">No games configured</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* REBATE RATES：顶部引导 + 升级进度 + 分级费率卡片（可左右翻动，默认当前等级） */}
      {levelCards.length > 0 && (
        <div className="rounded-2xl border border-white/5 bg-[#161512] py-4">
          <div className="mb-3 flex items-center justify-between px-4">
            <h3 className="text-sm font-semibold text-white">{t('cashback.rateTable')}</h3>
            {token && progress && (
              <span className="rounded-full bg-gradient-to-b from-[#e9c97e] to-[#cfa044] px-3 py-1 text-xs font-bold text-[#3a2a0d]">
                {t('cashback.levelTag', { level: progress.level })}
              </span>
            )}
          </div>

          {/* 冲刺最高级 banner */}
          {topBest && (
            <div className="mx-4 mb-3 flex items-center gap-2.5 rounded-xl border border-white/5 bg-black/20 px-3.5 py-2.5">
              <span className="text-xl leading-none">👑</span>
              <p className="text-[12px] font-bold text-amber-100 leading-snug">
                {t('cashback.topTierBanner', {
                  cat: t(catKeyOf(topBest.gameCategory)),
                  rate: topBest.ratePct,
                  amount: topBest.maxBonus > 0 ? amtStr(currency, topBest.maxBonus) : t('cashback.unlimited'),
                })}
              </p>
            </div>
          )}

          {/* total turnover：标签 + 数值 + 升级进度条 */}
          {token && progress && (
            <div className="mx-4 mb-3 rounded-2xl border border-white/5 bg-black/20 px-4 py-3">
              <p className="text-[11px] text-[#c9c9c5]">{t('cashback.totalTurnover')}</p>
              <p className="mt-0.5 font-display text-2xl font-bold text-white">{amtStr(currency, progress.totalTurnover)}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#e9c97e] to-[#cfa044] transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[11px] text-amber-300/80 mt-1.5">
                {progress.nextThreshold != null
                  ? t('cashback.progressToNext', { remaining: amtStr(currency, remaining), level: progress.nextLevel })
                  : t('cashback.maxLevel')}
              </p>
            </div>
          )}

          {/* 分级费率卡片横向轮播 */}
          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 pb-2 hide-scrollbar"
          >
            {levelCards.map((lc) => {
              const isCurrent = token && lc.level === userLevel
              const isMax = lc.level === (levelCards[levelCards.length - 1]?.level ?? lc.level)
              const cardCls = isMax
                ? 'border-amber-300/60 bg-gradient-to-br from-[#161006]/90 via-[#0d0a06]/85 to-[#3a2407]/50 shadow-lg shadow-amber-500/10'
                : isCurrent
                  ? 'border-amber-300/45 bg-[#100c06]/85'
                  : 'border-amber-300/18 bg-[#0c0905]/70'
              const catRates = CATEGORY_ORDER
                .map((cat) => lc.rates.find((r) => r.gameCategory === cat && r.enabled))
                .filter((r): r is NonNullable<typeof r> => Boolean(r))
              const toUnlock = progress ? Math.max(0, lc.minTurnover - progress.totalTurnover) : lc.minTurnover
              return (
                <div
                  key={lc.level}
                  ref={isCurrent ? activeCardRef : undefined}
                  className={`snap-center shrink-0 w-[82%] max-w-[330px] rounded-2xl border p-4 flex flex-col ${cardCls}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`font-black text-xl font-display ${isMax ? 'text-amber-300' : 'text-amber-50'}`}>
                          {t('cashback.levelTag', { level: lc.level })}
                        </span>
                        {isCurrent && (
                          <span className="bg-amber-300/90 text-[#1b1204] text-[10px] font-black rounded-full px-2 py-0.5">
                            {t('cashback.levelCurrent')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-amber-100/55 mt-0.5">
                        {lc.minTurnover > 0
                          ? t('cashback.levelReq', { amount: amtStr(currency, lc.minTurnover) })
                          : t('cashback.levelEntry')}
                      </p>
                    </div>
                    {isMax && (
                      <span className="bg-gradient-to-r from-amber-300 to-yellow-500 text-[#1b1204] text-[10px] font-black rounded-md px-2 py-1">MAX</span>
                    )}
                  </div>

                  <div className="space-y-2 flex-1">
                    {catRates.map((r) => {
                      const bonus = isCurrent ? (categoryBonusMap.get(r.gameCategory) ?? 0) : 0
                      return (
                        <button
                          key={r.gameCategory}
                          type="button"
                          onClick={() => onOpenCategory({ title: t(catKeyOf(r.gameCategory)), sortCategory: r.gameCategory })}
                          className="w-full flex items-center gap-2 active:opacity-70 transition-opacity"
                        >
                          <span className="text-xl leading-none flex-shrink-0">{CATEGORY_ICONS[r.gameCategory] ?? '🎮'}</span>
                          <span className="text-sm font-semibold text-amber-50/90 w-16 text-left truncate">{t(catKeyOf(r.gameCategory))}</span>
                          <span className="flex-1 text-right leading-tight">
                            <span className="block text-amber-300 font-bold text-sm">+{amtStr(currency, bonus)}</span>
                            <span className="block text-[9px] text-amber-100/45">
                              {t('cashback.maxShort')} {r.maxBonus > 0 ? amtStr(currency, r.maxBonus) : t('cashback.unlimited')}
                            </span>
                          </span>
                          <span className={`w-10 text-right font-black text-sm ${isMax ? 'text-amber-300' : 'text-amber-300/90'}`}>{r.ratePct}%</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* 底部解锁状态 */}
                  <div className={`mt-3 rounded-lg py-2 text-center text-xs font-black ${
                    isCurrent || (progress && lc.level < userLevel)
                      ? 'bg-[#5b3a0d]/55 text-amber-50'
                      : isMax
                        ? 'bg-gradient-to-r from-amber-300 to-yellow-500 text-[#1b1204]'
                        : 'bg-[#1c1408] text-amber-200'
                  }`}>
                    {isCurrent
                      ? t('cashback.levelCurrent')
                      : progress && lc.level < userLevel
                        ? t('cashback.unlocked')
                        : t('cashback.toUnlock', { amount: amtStr(currency, toUnlock) })}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-amber-100/35 mt-1 px-4 text-center">
            {t('cashback.creditedTomorrow')} · {t('cashback.unsettledNotCounted')}
          </p>
        </div>
      )}
      </div>
    </div>
  )
}
