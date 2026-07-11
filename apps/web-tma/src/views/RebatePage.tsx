import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchRebateConfig, fetchRebateProgress, claimRebate, type RebateConfig, type RebateProgress } from '@/api/rebate'
import { launchGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore, formatCurrencyAmount } from '@/stores/wallet'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'
import { ApiError } from '@/api/client'
import { analytics } from '@/utils/analytics'
import rebateHero from '@/assets/home/promos/rebate-hero-purple.webp'

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
}

function amtStr(currency: string, v: number) {
  return formatCurrencyAmount(currency, v)
}

function catKeyOf(cat: string) {
  return `cashback.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`
}

const BLUE = '#5db8f8'

const REDUCED_MOTION = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// 金额从上一个值滚动到目标值，reduced-motion 时直接显示目标值
function useCountUp(target: number, duration = 800) {
  const [val, setVal] = useState(REDUCED_MOTION ? target : 0)
  const prevRef = useRef(REDUCED_MOTION ? target : 0)
  useEffect(() => {
    if (REDUCED_MOTION) { setVal(target); return }
    const from = prevRef.current
    prevRef.current = target
    if (from === target) { setVal(target); return }
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      setVal(from + (target - from) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function RateIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-11 h-11" fill="none">
      <circle className="rb-breathe" cx="24" cy="24" r="21" stroke={BLUE} strokeOpacity="0.4" strokeWidth="2" />
      <circle cx="24" cy="24" r="16.5" stroke={BLUE} strokeWidth="2.5" />
      <text x="24" y="29" textAnchor="middle" fill={BLUE} fontSize="13" fontWeight="900" fontFamily="inherit">2%</text>
    </svg>
  )
}

function DailyIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-11 h-11" fill="none">
      <rect x="7" y="10" width="34" height="31" rx="6" fill={BLUE} fillOpacity="0.18" stroke={BLUE} strokeWidth="2.5" />
      <path d="M7 19h34" stroke={BLUE} strokeWidth="2.5" />
      <path d="M15 6v7M33 6v7" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="15" cy="26" r="1.8" fill={BLUE} />
      <circle cx="22" cy="26" r="1.8" fill={BLUE} />
      <circle cx="29" cy="26" r="1.8" fill={BLUE} />
      <circle cx="15" cy="33" r="1.8" fill={BLUE} />
      <path d="M25 33.5l3.2 3.2 5.8-6" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EveryIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-11 h-11" fill="none">
      <g className="rb-spin-burst" style={{ transformOrigin: '24px 24px' }}>
        <path d="M10 20a15 15 0 0 1 26.5-5.5" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M37 6.5v8.5h-8.5" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M38 28a15 15 0 0 1-26.5 5.5" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M11 41.5V33h8.5" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="24" y="29.5" textAnchor="middle" fill="#f6c453" fontSize="16" fontWeight="900" fontFamily="inherit">₱</text>
    </svg>
  )
}

function RebateFooter({ onGoBet }: { onGoBet: () => void }) {
  const { t } = useTranslation()
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const steps = [
    { title: t('cashback.footStep1Title'), sub: t('cashback.footStep1Sub') },
    { title: t('cashback.footStep2Title'), sub: t('cashback.footStep2Sub') },
    { title: t('cashback.footStep3Title'), sub: t('cashback.footStep3Sub') },
  ]
  const faqs = [
    { q: t('cashback.footFaq1Q'), a: t('cashback.footFaq1A') },
    { q: t('cashback.footFaq2Q'), a: t('cashback.footFaq2A') },
    { q: t('cashback.footFaq3Q'), a: t('cashback.footFaq3A') },
  ]
  const notes = [t('cashback.footNote1'), t('cashback.footNote2'), t('cashback.footNote3'), t('cashback.footNote4')]
  return (
    <section className="mx-4 mt-6">
      <h3 className="font-black text-violet-100 text-base tracking-wide">{t('cashback.footHowTitle').toUpperCase()}</h3>
      <div className="mt-3 space-y-2">
        {steps.map((step, i) => (
          <div key={step.title} className="flex items-center gap-3 rounded-xl bg-[#1a0e33]/75 border border-violet-400/20 px-3 py-2.5">
            <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#7cc8ff] to-[#2e9bf0] text-[13px] font-black text-[#06283f]">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-black leading-tight text-violet-50">{step.title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-violet-200/60">{step.sub}</span>
            </span>
          </div>
        ))}
      </div>

      <h3 className="mt-6 font-black text-violet-100 text-base tracking-wide">{t('cashback.footFaqTitle').toUpperCase()}</h3>
      <div className="mt-3 space-y-2">
        {faqs.map((faq, i) => {
          const open = openFaq === i
          return (
            <div key={faq.q} className="rounded-xl bg-[#1a0e33]/75 border border-violet-400/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenFaq(open ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left active:opacity-80"
              >
                <span className="text-[13px] font-bold text-violet-50">{faq.q}</span>
                <svg viewBox="0 0 16 16" className={`w-3.5 h-3.5 flex-shrink-0 text-[#5ec3ff] transition-transform ${open ? 'rotate-180' : ''}`} fill="none">
                  <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {open && (
                <p className="rb-faq-in px-3.5 pb-3 text-[12px] leading-relaxed text-violet-200/70">{faq.a}</p>
              )}
            </div>
          )
        })}
      </div>

      <h3 className="mt-6 font-black text-violet-100 text-base tracking-wide">{t('cashback.footNotesTitle').toUpperCase()}</h3>
      <ul className="mt-3 space-y-1.5 rounded-xl bg-[#1a0e33]/75 border border-violet-400/20 px-3.5 py-3">
        {notes.map((note) => (
          <li key={note} className="flex gap-2 text-[11px] leading-snug text-violet-200/60">
            <span className="mt-[5px] h-[4px] w-[4px] flex-shrink-0 rounded-full bg-[#38a8f8]/80" />
            {note}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onGoBet}
        className="rb-shine mt-6 w-full bg-gradient-to-b from-[#7cc8ff] to-[#2e9bf0] text-[#06283f] font-black text-base rounded-full py-3.5 shadow-[0_4px_18px_rgba(46,155,240,0.4)] active:opacity-80 transition"
      >
        {t('cashback.goBet')}
      </button>
    </section>
  )
}

export default function RebatePage({ onOpenGame, onOpenCategory }: Props) {
  const { t } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const locale = useLocaleStore((s) => s.locale)
  const currency = activeCurrency

  const [config, setConfig] = useState<RebateConfig | null>(null)
  const [progress, setProgress] = useState<RebateProgress | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [expandedTier, setExpandedTier] = useState<string | null>(null)
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  void launchingUuid // 保留，后续可扩展 loading 状态展示

  useEffect(() => {
    fetchRebateConfig().then(setConfig).catch(() => null)
  }, [])

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
      await Promise.all([loadProgress(), useWalletStore.getState().refresh()])
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

  const features = [
    { icon: <RateIcon />, title: t('cashback.heroRateLabel'), desc: t('cashback.featRateDesc') },
    { icon: <DailyIcon />, title: t('cashback.heroCreditValue'), desc: t('cashback.featDailyDesc') },
    { icon: <EveryIcon />, title: t('cashback.heroFeaturedValue'), desc: t('cashback.featEveryDesc') },
  ]

  const claimableTarget = token ? (progress?.claimable ?? 0) : 0
  const animatedClaimable = useCountUp(claimableTarget)

  return (
    <div className="page-main pb-8 min-h-screen bg-[#0f0a1d]">
      {/* Hero —— 设计稿成品图贴顶（含标题/徽章/副标题） */}
      <img
        src={rebateHero}
        alt={t('cashback.pageTitle')}
        className="block w-full select-none"
        draggable={false}
      />

      {/* 内容区背景与 hero 裁剪线无缝衔接 */}
      <div style={{ background: 'linear-gradient(180deg,#26174c 0%,#1c0e38 40%,#150c28 72%,#0f0a1d 100%)' }}>
        {/* Total Bonus —— 功能区，Claim 在右 */}
        <div className="rb-rise mx-4 relative overflow-hidden rounded-2xl border-[1.5px] border-violet-400/45 bg-[#231240]/70 shadow-[0_0_24px_rgba(139,92,246,0.15)]">
          <div className="pointer-events-none absolute right-20 top-1/2 -translate-y-1/2 h-28 w-28 rounded-full bg-[#38a8f8]/15 blur-2xl" />
          <div className="relative flex items-center justify-between gap-3 px-4 py-4">
            <div className="min-w-0">
              <p className="text-violet-300 font-bold text-[12px] uppercase tracking-widest">{t('cashback.totalBonus')}</p>
              <p className={`text-white font-black text-[26px] font-display drop-shadow mt-1 ${claimableTarget > 0 ? 'rb-pop' : ''}`}>
                {amtStr(currency, animatedClaimable)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onClaim()}
              disabled={claiming || !token || !progress || progress.claimable <= 0}
              className={`flex-shrink-0 bg-gradient-to-b from-[#7cc8ff] to-[#2e9bf0] text-[#06283f] font-black text-base rounded-full px-7 py-2.5 shadow-[0_3px_14px_rgba(46,155,240,0.45)] active:opacity-80 transition disabled:opacity-50 ${!claiming && claimableTarget > 0 ? 'rb-claim-live' : ''}`}
            >
              {claiming ? t('cashback.claiming') : t('cashback.claimBtn')}
            </button>
          </div>
        </div>

        {token && claimableBreakdown.length > 0 && (
          <div className="rb-rise mx-4 mt-2 bg-[#1a0e33]/70 rounded-2xl px-4 py-3 space-y-1.5 border border-violet-400/20" style={{ animationDelay: '45ms' }}>
            {claimableBreakdown.map((item) => (
              <div key={item.gameCategory} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-violet-100/70">
                  <span>{CATEGORY_ICONS[item.gameCategory] ?? '🎮'}</span>
                  <span>{t(catKeyOf(item.gameCategory))}</span>
                  <span className="text-[10px] text-[#5ec3ff]/80">{item.ratePct}%</span>
                </span>
                <span className="font-semibold text-[#5ec3ff]">+{amtStr(currency, item.rebateAmount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* 三个特性卡片：Max Rate / Daily / Every */}
        <div className="mx-4 mt-3 grid grid-cols-3 gap-2.5">
          {features.map((f, i) => (
            <div key={f.title} className="rb-rise rounded-2xl border border-violet-400/30 bg-[#1e1038]/55 px-2 py-4 flex flex-col items-center text-center" style={{ animationDelay: `${90 + i * 45}ms` }}>
              {f.icon}
              <p className="text-white font-black text-sm mt-2.5">{f.title}</p>
              <p className="text-violet-200/60 text-[11px] leading-snug mt-1">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* CASHBACK GAMES */}
        {tiers.length > 0 && (
          <div className="rb-rise mx-4 mt-5" style={{ animationDelay: '225ms' }}>
            <h3 className="font-black text-violet-100 text-base tracking-wide mb-3">{t('cashback.cashbackGames').toUpperCase()}</h3>
            <div className="space-y-3">
              {tiers.map(([tier, games]) => {
                const cover = games[0]?.coverUrl
                const expanded = expandedTier === tier
                return (
                  <div key={tier} className="rounded-2xl bg-[#1a0e33]/75 border border-violet-400/25 overflow-hidden shadow-[0_0_18px_rgba(139,92,246,0.1)]">
                    <div className="flex items-center gap-3 p-3">
                      <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-black/35 border border-violet-400/20">
                        {cover
                          ? <img src={cover} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-2xl">🎰</div>
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[#5ec3ff] font-black text-sm">
                          {t(tier === 'elite' ? 'cashback.tierElite' : 'cashback.tierPro')}
                        </p>
                        <div className="flex gap-5 mt-1">
                          <div>
                            <p className="text-violet-200/55 text-[10px]">{t('cashback.cashbackRate')}</p>
                            <p className="text-violet-50 font-bold text-sm">{tierRate(tier)}</p>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleTier(tier)}
                        className="rb-shine flex-shrink-0 flex items-center gap-1.5 bg-gradient-to-r from-[#7cc8ff] to-[#2e9bf0] text-[#06283f] rounded-full pl-4 pr-1.5 py-1.5 active:opacity-80 transition-opacity shadow-[0_2px_10px_rgba(46,155,240,0.3)]"
                      >
                        <span className="font-bold text-xs">{t('cashback.viewBtn')}</span>
                        <span className="bg-[#06283f]/30 text-[#eaf6ff] text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                          {games.length}
                        </span>
                      </button>
                    </div>
                    {expanded && (
                      <div className="px-3 pb-3 border-t border-violet-400/20 pt-3">
                        {games.length > 0 ? (
                          <div className="grid grid-cols-3 gap-2">
                            {games.map((g) => (
                              <button
                                key={g.gameUuid}
                                type="button"
                                onClick={() => void onGameTap(g.gameUuid)}
                                className="flex flex-col rounded-xl overflow-hidden bg-[#241542] active:scale-[0.98] transition-transform"
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
          <div className="rb-rise mt-5" style={{ animationDelay: '270ms' }}>
            <div className="flex items-center justify-between mb-3 mx-4">
              <h3 className="font-black text-violet-100 text-base tracking-wide">{t('cashback.rateTable').toUpperCase()}</h3>
              {token && progress && (
                <span className="bg-gradient-to-r from-[#7cc8ff] to-[#2e9bf0] text-[#06283f] font-black text-xs rounded-full px-3 py-1">
                  {t('cashback.levelTag', { level: progress.level })}
                </span>
              )}
            </div>

            {/* 冲刺最高级 banner */}
            {topBest && (
              <div className="mx-4 mb-3 flex items-center gap-2.5 rounded-xl border border-violet-400/35 bg-gradient-to-r from-[#33195e]/75 via-[#221244]/80 to-[#150c28]/85 px-3.5 py-2.5">
                <span className="text-xl leading-none">👑</span>
                <p className="text-[12px] font-bold text-violet-100 leading-snug">
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
              <div className="mx-4 mb-3 bg-[#1a0e33]/75 rounded-2xl border border-violet-400/25 px-4 py-3">
                <p className="text-violet-200/60 text-[11px]">{t('cashback.totalTurnover')}</p>
                <p className="text-white font-black text-2xl font-display mt-0.5">{amtStr(currency, progress.totalTurnover)}</p>
                <div className="h-2 rounded-full bg-black/30 overflow-hidden mt-2">
                  <div
                    className="rb-progress-fill h-full bg-gradient-to-r from-[#9ad8ff] to-[#38a8f8] rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-[#5ec3ff]/80 mt-1.5">
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
                  ? 'border-[#38a8f8]/60 bg-gradient-to-br from-[#2c1552]/90 via-[#1c0f38]/85 to-[#471b56]/50 shadow-lg shadow-sky-500/10'
                  : isCurrent
                    ? 'border-violet-300/50 bg-[#221244]/85'
                    : 'border-violet-400/20 bg-[#180d30]/70'
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
                          <span className={`font-black text-xl font-display ${isMax ? 'text-[#5ec3ff]' : 'text-violet-50'}`}>
                            {t('cashback.levelTag', { level: lc.level })}
                          </span>
                          {isCurrent && (
                            <span className="bg-[#38a8f8] text-[#06283f] text-[10px] font-black rounded-full px-2 py-0.5">
                              {t('cashback.levelCurrent')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-violet-200/55 mt-0.5">
                          {lc.minTurnover > 0
                            ? t('cashback.levelReq', { amount: amtStr(currency, lc.minTurnover) })
                            : t('cashback.levelEntry')}
                        </p>
                      </div>
                      {isMax && (
                        <span className="bg-gradient-to-r from-[#7cc8ff] to-[#2e9bf0] text-[#06283f] text-[10px] font-black rounded-md px-2 py-1">MAX</span>
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
                            <span className="text-sm font-semibold text-violet-50/90 w-16 text-left truncate">{t(catKeyOf(r.gameCategory))}</span>
                            <span className="flex-1 text-right leading-tight">
                              <span className="block text-[#5ec3ff] font-bold text-sm">+{amtStr(currency, bonus)}</span>
                              <span className="block text-[9px] text-violet-200/45">
                                {t('cashback.maxShort')} {r.maxBonus > 0 ? amtStr(currency, r.maxBonus) : t('cashback.unlimited')}
                              </span>
                            </span>
                            <span className={`w-10 text-right font-black text-sm ${isMax ? 'text-[#5ec3ff]' : 'text-[#5ec3ff]/90'}`}>{r.ratePct}%</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* 底部解锁状态 */}
                    <div className={`mt-3 rounded-lg py-2 text-center text-xs font-black ${
                      isCurrent || (progress && lc.level < userLevel)
                        ? 'bg-violet-500/30 text-violet-50'
                        : isMax
                          ? 'bg-gradient-to-r from-[#7cc8ff] to-[#2e9bf0] text-[#06283f]'
                          : 'bg-[#241542] text-violet-200'
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
            <p className="text-[10px] text-violet-200/35 mt-1 px-4 text-center">
              {t('cashback.creditedTomorrow')} · {t('cashback.unsettledNotCounted')}
            </p>
          </div>
        )}

        <RebateFooter onGoBet={() => onOpenCategory({ title: t('cashback.categorySlots'), sortCategory: 'slots' })} />
      </div>
    </div>
  )
}
