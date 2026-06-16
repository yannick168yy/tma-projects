import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchRebateConfig, fetchRebateSummary, fetchRebateProgress, claimRebate, type RebateConfig, type RebateSummary, type RebateProgress } from '@/api/rebate'
import { launchGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'
import { ApiError } from '@/api/client'
import { AutoCreditIcon, EveryBetIcon, MaxRateIcon } from '@/components/cashback/CashbackHeroIcons'

type DateTab = 'today' | 'yesterday'

const CATEGORY_ICONS: Record<string, string> = {
  slots: '🎰', live: '🎲', sports: '⚽', fishing: '🐟',
  table: '🃏', bingo: '🎱', crash: '🚀', pinoy: '🐓', other: '🎮',
}

// 与首页游戏大类选项保持一致的展示顺序
const CATEGORY_ORDER = ['slots', 'live', 'table', 'bingo', 'sports', 'fishing', 'crash', 'pinoy', 'other']
const catRank = (cat: string) => {
  const i = CATEGORY_ORDER.indexOf(cat)
  return i === -1 ? CATEGORY_ORDER.length : i
}

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
      onOpenGame(url)
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Launch failed') }
    finally { setLaunchingUuid(null) }
  }

  const levelCards = config?.levels ?? []
  const userLevel = progress?.level ?? 1

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
    <div className="page-main pb-6">
      {/* Hero —— 暗绿渐变 + 绿金搭配 */}
      <div
        className="relative px-4 pt-14 pb-5 overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #14532d 0%, #0a2e1a 42%, #080b14 75%)' }}
      >
        <div className="pointer-events-none absolute -top-8 -right-6 h-28 w-28 rounded-full bg-amber-400/20 blur-2xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-24 rounded-full bg-emerald-500/15 blur-xl" />
        <p className="relative text-emerald-200/90 text-[11px] uppercase tracking-widest font-bold mb-1">
          {t('cashback.pageSubtitle')}
        </p>
        <h1 className="relative font-black leading-tight mb-1 font-display text-[1.8rem] drop-shadow-sm bg-gradient-to-r from-white via-emerald-100 to-amber-300 bg-clip-text text-transparent">
          {t('cashback.pageTitle')}
        </h1>
        <p className="relative text-emerald-100/65 text-xs max-w-[280px] leading-relaxed">{t('cashback.bannerSub')}</p>
        <div className="relative flex gap-3 mt-4">
          {[
            { Icon: MaxRateIcon, value: t('cashback.tierEliteRate'), label: t('cashback.heroRateLabel') },
            { Icon: AutoCreditIcon, value: t('cashback.heroCreditValue'), label: t('cashback.heroCreditLabel') },
            { Icon: EveryBetIcon, value: t('cashback.heroFeaturedValue'), label: t('cashback.heroFeaturedLabel') },
          ].map((s) => (
            <div key={s.label} className="flex-1 bg-emerald-950/40 rounded-xl px-2.5 py-2.5 text-center border border-emerald-400/25 backdrop-blur-sm">
              <div className="flex justify-center mb-1">
                <s.Icon className="h-6 w-6" />
              </div>
              <p className="text-amber-300 font-black text-sm leading-none">{s.value}</p>
              <p className="text-emerald-200/55 text-[9px] mt-1 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 今日 / 昨日 药丸 Tab */}
      <div className="mx-4 mt-3">
        <div className="flex rounded-full p-1 gap-1 bg-emerald-950/60 border border-emerald-700/35">
          {(['today', 'yesterday'] as DateTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 rounded-full text-sm font-bold transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-amber-400 to-yellow-500 text-emerald-950 shadow-md shadow-amber-500/25'
                  : 'text-emerald-300/70'
              }`}
            >
              {t(tab === 'today' ? 'cashback.tabToday' : 'cashback.tabYesterday')}
            </button>
          ))}
        </div>
      </div>

      {/* 绿金 Total Bonus 横条 + 领取按钮（金额=可领取池） */}
      <div className="mx-4 mt-3 relative overflow-hidden rounded-2xl border border-emerald-600/30">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-700 via-emerald-800 to-amber-500" />
        <div className="absolute -top-6 -right-2 h-20 w-20 rounded-full bg-white/15" />
        <div className="relative flex items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="text-amber-200 font-black text-lg leading-tight font-display">{t('cashback.totalBonus')}</p>
            <p className="text-emerald-50 font-black text-2xl font-display drop-shadow mt-0.5">
              {amtStr(currency, token ? (progress?.claimable ?? 0) : 0)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onClaim()}
            disabled={claiming || !token || !progress || progress.claimable <= 0}
            className="flex-shrink-0 bg-gradient-to-r from-amber-400 to-yellow-500 text-emerald-950 font-black text-sm rounded-full px-6 py-2.5 shadow-md shadow-amber-500/25 active:opacity-80 transition disabled:opacity-50"
          >
            {claiming ? t('cashback.claiming') : t('cashback.claimBtn')}
          </button>
        </div>
      </div>

      {/* 投注明细（有数据时展示） */}
      {token && summary && summary.breakdown.length > 0 && (
        <div className="mx-4 mt-2 bg-emerald-950/40 rounded-2xl px-4 py-3 space-y-1.5 border border-emerald-800/30">
          {summary.breakdown.map((item) => (
            <div key={item.gameCategory} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-emerald-200/70">
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
          <h3 className="font-black text-emerald-100 text-base tracking-wide mb-3">{t('cashback.cashbackGames').toUpperCase()}</h3>
          <div className="space-y-3">
            {tiers.map(([tier, games]) => {
              const cover = games[0]?.coverUrl
              const expanded = expandedTier === tier
              return (
                <div key={tier} className="rounded-2xl bg-emerald-950/35 border border-emerald-700/30 overflow-hidden">
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-emerald-950/60 border border-emerald-700/25">
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
                          <p className="text-emerald-300/60 text-[10px]">{t('cashback.cashbackRate')}</p>
                          <p className="text-emerald-100 font-bold text-sm">{tierRate(tier)}</p>
                        </div>
                        <div>
                          <p className="text-emerald-300/60 text-[10px]">{t('cashback.bonusLabel')}</p>
                          <p className="text-amber-300 font-bold text-sm">{amtStr(currency, token ? (tierBonusMap.get(tier) ?? 0) : 0)}</p>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleTier(tier)}
                      className="flex-shrink-0 flex items-center gap-1.5 bg-gradient-to-r from-amber-400 to-yellow-500 text-emerald-950 rounded-full pl-4 pr-1.5 py-1.5 active:opacity-80 transition-opacity"
                    >
                      <span className="font-bold text-xs">{t('cashback.viewBtn')}</span>
                      <span className="bg-emerald-900/40 text-amber-100 text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                        {games.length}
                      </span>
                    </button>
                  </div>
                  {expanded && (
                    <div className="px-3 pb-3 border-t border-emerald-700/30 pt-3">
                      {games.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                          {games.map((g) => (
                            <button
                              key={g.gameUuid}
                              type="button"
                              onClick={() => void onGameTap(g.gameUuid)}
                              className="flex flex-col rounded-xl overflow-hidden bg-background active:scale-[0.98] transition-transform"
                            >
                              <div className="aspect-square w-full bg-secondary">
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

      {/* REBATE RATES：升级进度 + 分级费率卡片（可左右翻动，默认当前等级） */}
      {levelCards.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3 mx-4">
            <h3 className="font-black text-emerald-100 text-base tracking-wide">{t('cashback.rateTable').toUpperCase()}</h3>
            {token && progress && (
              <span className="bg-gradient-to-r from-amber-400 to-yellow-500 text-emerald-950 font-black text-xs rounded-full px-3 py-1">
                {t('cashback.levelTag', { level: progress.level })}
              </span>
            )}
          </div>

          {/* total turnover：标签 + 数值 + 升级进度条 */}
          {token && progress && (
            <div className="mx-4 mb-3 bg-emerald-950/40 rounded-2xl border border-emerald-700/30 px-4 py-3">
              <p className="text-emerald-300/70 text-[11px]">{t('cashback.totalTurnover')}</p>
              <p className="text-emerald-50 font-black text-2xl font-display mt-0.5">{amtStr(currency, progress.totalTurnover)}</p>
              <div className="h-2 rounded-full bg-emerald-900/60 overflow-hidden mt-2">
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
                ? 'border-amber-400/70 bg-gradient-to-br from-purple-900/70 via-fuchsia-900/40 to-amber-600/40 shadow-lg shadow-amber-500/20'
                : isCurrent
                  ? 'border-amber-400/55 bg-emerald-900/55'
                  : 'border-emerald-700/30 bg-emerald-950/40'
              const catRates = lc.rates.filter((r) => r.enabled).sort((a, b) => catRank(a.gameCategory) - catRank(b.gameCategory))
              return (
                <div
                  key={lc.level}
                  ref={isCurrent ? activeCardRef : undefined}
                  className={`snap-center shrink-0 w-[80%] max-w-[320px] rounded-2xl border p-4 ${cardCls}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`font-black text-lg font-display ${isMax ? 'text-amber-300' : 'text-emerald-50'}`}>
                        {isMax && '👑 '}{t('cashback.levelTag', { level: lc.level })}
                      </span>
                      {isCurrent && (
                        <span className="bg-amber-400/90 text-emerald-950 text-[10px] font-black rounded-full px-2 py-0.5">
                          {t('cashback.levelCurrent')}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-emerald-300/60 text-right">
                      {lc.minTurnover > 0
                        ? t('cashback.levelReq', { amount: amtStr(currency, lc.minTurnover) })
                        : t('cashback.levelEntry')}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {catRates.map((r) => (
                      <button
                        key={r.gameCategory}
                        type="button"
                        onClick={() => onOpenCategory({ title: t(catKeyOf(r.gameCategory)), sortCategory: r.gameCategory })}
                        className="w-full flex items-center justify-between py-1 active:opacity-70 transition-opacity"
                      >
                        <span className="flex items-center gap-2 text-sm text-emerald-50/90">
                          <span className="text-lg leading-none">{CATEGORY_ICONS[r.gameCategory] ?? '🎮'}</span>
                          {t(catKeyOf(r.gameCategory))}
                        </span>
                        <span className={`font-black text-sm ${isMax ? 'text-amber-300' : 'text-amber-300/90'}`}>{r.ratePct}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-emerald-400/50 mt-1 px-4">{t('cashback.rateTableDesc')}</p>
        </div>
      )}
    </div>
  )
}
