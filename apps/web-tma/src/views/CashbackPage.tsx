import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchRebateConfig, fetchRebateSummary, fetchRebateProgress, claimRebate, type RebateConfig, type RebateSummary, type RebateProgress } from '@/api/rebate'
import { launchGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'
import { ApiError } from '@/api/client'
import { analytics } from '@/utils/analytics'
import cashbackHero from '@/assets/home/promos/cashback-hero-2.webp'

type DateTab = 'today' | 'yesterday'

const CATEGORY_ICONS: Record<string, string> = {
  slots: '🎰', live: '🎲', sports: '⚽', fishing: '🐟',
  table: '🃏', bingo: '🎱', crash: '🚀', pinoy: '🐓', other: '🎮',
}

// 洗码等级卡片固定展示的 6 个大类（Slot/Casino/Sports/Fish/Poker/Bingo）
const CARD_CATEGORIES = ['slots', 'live', 'sports', 'fishing', 'table', 'bingo']

interface Props {
  onOpenGame: (url: string) => void
  onOpenCategory: (params: { title: string; sortCategory: string }) => void
}

function amtStr(currency: string, v: number) {
  return formatCurrencyAmount(currency, v)
}

function catKeyOf(cat: string) {
  return `cashback.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`
}

export default function CashbackPage({ onOpenGame, onOpenCategory }: Props) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const locale = useLocaleStore((s) => s.locale)
  const currency = activeCurrency

  const [activeTab, setActiveTab] = useState<DateTab>('today')
  const [config, setConfig] = useState<RebateConfig | null>(null)
  const [summary, setSummary] = useState<RebateSummary | null>(null)
  const [progress, setProgress] = useState<RebateProgress | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [expandedTier, setExpandedTier] = useState<string | null>(null)
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  void launchingUuid // 保留，后续可扩展 loading 状态展示

  useEffect(() => {
    fetchRebateConfig().then(setConfig).catch(() => null)
  }, [])

  const loadSummary = useCallback(async (tab: DateTab) => {
    if (!token) return
    try {
      const s = await fetchRebateSummary(tab, currency)
      setSummary(s)
    } catch {
      setSummary(null)
    }
  }, [token, currency])

  useEffect(() => { void loadSummary(activeTab) }, [activeTab, loadSummary])

  const loadProgress = useCallback(async () => {
    if (!token) { setProgress(null); return }
    try { setProgress(await fetchRebateProgress(currency)) } catch { setProgress(null) }
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
      await Promise.all([loadProgress(), loadSummary(activeTab), useWalletStore.getState().refresh()])
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Claim failed')
    } finally { setClaiming(false) }
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

  // 今日各大类已得洗码（用于当前等级卡内 Bonus 显示）
  const categoryBonusMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of summary?.breakdown ?? []) m.set(b.gameCategory, b.rebateAmount)
    return m
  }, [summary?.breakdown])

  // 顶部 banner：取最高等级费率最高的大类
  const topTier = levelCards.length ? levelCards[levelCards.length - 1] : null
  const topBest = topTier
    ? topTier.rates.filter((r) => r.enabled && CARD_CATEGORIES.includes(r.gameCategory))
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

  const tierBonusMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of summary?.tierBreakdown ?? []) {
      map.set(item.tier, item.rebateAmount)
    }
    return map
  }, [summary?.tierBreakdown])

  return (
    <div
      className="page-main pb-8 min-h-screen"
      style={{ background: 'linear-gradient(180deg,#030302 0%,#080603 32%,#0b0804 64%,#040302 100%)' }}
    >
      {/* Hero —— 成品 banner 图贴顶 */}
      <img
        src={cashbackHero}
        alt={t('cashback.pageTitle')}
        className="block w-full select-none"
        draggable={false}
      />

      {/* 今日 / 昨日 分段控件 —— 紧凑 + 金色质感选中 */}
      <div className="mx-4 mt-4">
        <div className="flex rounded-2xl p-1 gap-1 bg-[#0a0804]/85 border border-amber-300/20 backdrop-blur-sm shadow-inner shadow-black/60">
          {(['today', 'yesterday'] as DateTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-b from-amber-300 to-yellow-500 text-[#2a1a05] shadow-[0_2px_10px_rgba(245,158,11,0.4)]'
                  : 'text-amber-100/45'
              }`}
            >
              {t(tab === 'today' ? 'cashback.tabToday' : 'cashback.tabYesterday')}
            </button>
          ))}
        </div>
      </div>

      {/* Total Bonus —— 紧凑横排，Claim 在右 */}
      <div className="mx-4 mt-3 relative overflow-hidden rounded-2xl border border-amber-300/35 bg-gradient-to-r from-[#0b0804]/90 via-[#171006]/80 to-[#2c1b05]/55 shadow-[0_0_24px_rgba(180,118,28,0.12)]">
        <div className="pointer-events-none absolute right-20 top-1/2 -translate-y-1/2 h-28 w-28 rounded-full bg-amber-300/20 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-amber-200/90 font-bold text-[11px] uppercase tracking-wider">{t('cashback.totalBonus')}</p>
            <p className="text-white font-black text-2xl font-display drop-shadow mt-0.5">
              {amtStr(currency, token ? (progress?.claimable ?? 0) : 0)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onClaim()}
            disabled={claiming || !token || !progress || progress.claimable <= 0}
            className="flex-shrink-0 bg-gradient-to-b from-amber-300 to-yellow-500 text-[#2a1a05] font-black text-sm rounded-full px-6 py-2.5 shadow-[0_3px_12px_rgba(245,158,11,0.45)] active:opacity-80 transition disabled:opacity-50"
          >
            {claiming ? t('cashback.claiming') : t('cashback.claimBtn')}
          </button>
        </div>
      </div>

      {/* 投注明细（有数据时展示） */}
      {token && summary && summary.breakdown.length > 0 && (
        <div className="mx-4 mt-2 bg-[#0c0905]/70 rounded-2xl px-4 py-3 space-y-1.5 border border-amber-300/15">
          {summary.breakdown.map((item) => (
            <div key={item.gameCategory} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-amber-50/70">
                <span>{CATEGORY_ICONS[item.gameCategory] ?? '🎮'}</span>
                <span>{t(catKeyOf(item.gameCategory))}</span>
                <span className="text-[10px] text-amber-300/80">{item.ratePct}%</span>
              </span>
              <span className="font-semibold text-amber-300">+{amtStr(currency, item.rebateAmount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* CASHBACK GAMES */}
      {tiers.length > 0 && (
        <div className="mx-4 mt-5">
          <h3 className="font-black text-amber-100 text-base tracking-wide mb-3">{t('cashback.cashbackGames').toUpperCase()}</h3>
          <div className="space-y-3">
            {tiers.map(([tier, games]) => {
              const cover = games[0]?.coverUrl
              const expanded = expandedTier === tier
              return (
                <div key={tier} className="rounded-2xl bg-[#0c0905]/75 border border-amber-300/20 overflow-hidden shadow-[0_0_18px_rgba(180,118,28,0.08)]">
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-black/35 border border-amber-300/15">
                      {cover
                        ? <img src={cover} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-2xl">🎰</div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-amber-300 font-black text-sm">
                        {t(tier === 'elite' ? 'cashback.tierElite' : 'cashback.tierPro')}
                      </p>
                      <div className="flex gap-5 mt-1">
                        <div>
                          <p className="text-amber-100/55 text-[10px]">{t('cashback.cashbackRate')}</p>
                          <p className="text-amber-50 font-bold text-sm">{tierRate(tier)}</p>
                        </div>
                        <div>
                          <p className="text-amber-100/55 text-[10px]">{t('cashback.bonusLabel')}</p>
                          <p className="text-amber-300 font-bold text-sm">{amtStr(currency, token ? (tierBonusMap.get(tier) ?? 0) : 0)}</p>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleTier(tier)}
                      className="flex-shrink-0 flex items-center gap-1.5 bg-gradient-to-r from-amber-300 to-yellow-500 text-[#1b1204] rounded-full pl-4 pr-1.5 py-1.5 active:opacity-80 transition-opacity shadow-[0_2px_10px_rgba(245,158,11,0.25)]"
                    >
                      <span className="font-bold text-xs">{t('cashback.viewBtn')}</span>
                      <span className="bg-[#5b3a0d]/55 text-amber-100 text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                        {games.length}
                      </span>
                    </button>
                  </div>
                  {expanded && (
                    <div className="px-3 pb-3 border-t border-amber-300/15 pt-3">
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
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3 mx-4">
            <h3 className="font-black text-amber-100 text-base tracking-wide">{t('cashback.rateTable').toUpperCase()}</h3>
            {token && progress && (
              <span className="bg-gradient-to-r from-amber-300 to-yellow-500 text-[#1b1204] font-black text-xs rounded-full px-3 py-1">
                {t('cashback.levelTag', { level: progress.level })}
              </span>
            )}
          </div>

          {/* 冲刺最高级 banner */}
          {topBest && (
            <div className="mx-4 mb-3 flex items-center gap-2.5 rounded-xl border border-amber-300/35 bg-gradient-to-r from-[#2b1a05]/75 via-[#151006]/80 to-[#070504]/85 px-3.5 py-2.5">
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
            <div className="mx-4 mb-3 bg-[#0c0905]/75 rounded-2xl border border-amber-300/20 px-4 py-3">
              <p className="text-amber-100/60 text-[11px]">{t('cashback.totalTurnover')}</p>
              <p className="text-amber-50 font-black text-2xl font-display mt-0.5">{amtStr(currency, progress.totalTurnover)}</p>
              <div className="h-2 rounded-full bg-black/30 overflow-hidden mt-2">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-yellow-500 rounded-full transition-all"
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
              const isMax = lc.level === 6
              const cardCls = isMax
                ? 'border-amber-300/60 bg-gradient-to-br from-[#161006]/90 via-[#0d0a06]/85 to-[#3a2407]/50 shadow-lg shadow-amber-500/10'
                : isCurrent
                  ? 'border-amber-300/45 bg-[#100c06]/85'
                  : 'border-amber-300/18 bg-[#0c0905]/70'
              // 固定 6 类，按设计顺序，仅取启用项
              const catRates = CARD_CATEGORIES
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
  )
}
