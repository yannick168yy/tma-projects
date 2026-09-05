import { useEffect, useMemo, useRef, useState } from 'react'
import { Crown } from 'lucide-react'
import { fetchBettingActivity, type BetRecord, type BetTab } from '@/api/slots'
import { localizedGameName } from '@/utils/game'

// 最新投注整列滚动：一屏约 8 条，太快看不清也晃眼
const BET_SCROLL_MIN_DURATION_SECONDS = 32
const BET_SCROLL_SECONDS_PER_ITEM = 2.8

const RANK_TOP_STYLES = [
  { row: 'bg-gradient-to-r from-amber-500/25 via-amber-500/8 to-transparent border-amber-400/25', medal: 'bg-gradient-to-br from-amber-200 to-amber-500 text-amber-950 shadow-[0_3px_12px_rgba(245,158,11,0.55)]', ring: 'ring-2 ring-amber-400/60', amount: 'text-amber-300' },
  { row: 'bg-gradient-to-r from-slate-200/18 via-slate-200/6 to-transparent border-slate-300/20', medal: 'bg-gradient-to-br from-slate-100 to-slate-400 text-slate-800 shadow-[0_3px_10px_rgba(203,213,225,0.45)]', ring: 'ring-2 ring-slate-300/55', amount: 'text-slate-100' },
  { row: 'bg-gradient-to-r from-orange-700/22 via-orange-700/7 to-transparent border-orange-500/20', medal: 'bg-gradient-to-br from-orange-300 to-orange-600 text-orange-950 shadow-[0_3px_10px_rgba(194,120,3,0.45)]', ring: 'ring-2 ring-orange-500/55', amount: 'text-orange-300' },
]

/**
 * 投注榜（P3-1 从 HomeContent 拆出）。
 *
 * 自己管 tab 状态与三份数据的懒加载：三个 tab 各拉一次、拉过就不再拉，
 * 首屏只拉「最新」那份 —— 榜单是首页最靠下的块，进页面就拉三份纯属浪费。
 */
export default function BettingTable({ currency, locale, t, onTapGame }: {
  currency: string
  locale: string
  t: (key: string) => string
  onTapGame: (uuid: string) => void
}) {
  const betSectionRef = useRef<HTMLElement>(null)
  const [activeBetTab, setActiveBetTab] = useState<BetTab>('latest')
  const [latestBets, setLatestBets] = useState<BetRecord[]>([])
  const [weekBets, setWeekBets] = useState<BetRecord[]>([])
  const [monthBets, setMonthBets] = useState<BetRecord[]>([])
  const [betLoaded, setBetLoaded] = useState<Record<BetTab, boolean>>({ latest: false, week: false, month: false })

  function formatBet(amount: number, cur: string) {
    return cur === 'IDR' ? `Rp ${amount.toLocaleString('en-US')}` : `₱ ${amount.toLocaleString('en-PH')}`
  }

  async function loadBetTab(tab: BetTab) {
    if (betLoaded[tab]) return
    setBetLoaded((prev) => ({ ...prev, [tab]: true }))
    try {
      const data = await fetchBettingActivity(tab, currency)
      if (tab === 'latest') setLatestBets(data)
      else if (tab === 'week') setWeekBets(data)
      else setMonthBets(data)
    } catch { /* 榜单拉不到就留骨架，不打扰用户 */ }
  }

  async function switchBetTab(tab: BetTab) {
    setActiveBetTab(tab)
    await loadBetTab(tab)
  }

  // 榜单在首页最靠下，滚到它前 200px 才拉数据；换币种要清空重拉
  useEffect(() => {
    setLatestBets([]); setWeekBets([]); setMonthBets([])
    setBetLoaded({ latest: false, week: false, month: false })
    const el = betSectionRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        fetchBettingActivity('latest', currency)
          .then((data) => { setLatestBets(data); setBetLoaded((prev) => ({ ...prev, latest: true })) })
          .catch(() => { /* 拉不到就留骨架 */ })
        observer.disconnect()
      }
    }, { threshold: 0.1, rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [currency])

  const latestBetsLoop = useMemo(() => [...latestBets, ...latestBets], [latestBets])
  const rankBets = activeBetTab === 'week' ? weekBets : monthBets
  const latestBetScrollDuration = `${Math.max(BET_SCROLL_MIN_DURATION_SECONDS, latestBets.length * BET_SCROLL_SECONDS_PER_ITEM)}s`

  function betTabLabel(tab: BetTab) {
    if (tab === 'latest') return t('home.latestBets')
    if (tab === 'week') return t('home.topWeek')
    return t('home.topMonth')
  }

  return (
      <section ref={betSectionRef} className="mt-8 px-4">
        <h3 className="text-muted-foreground font-black text-xs font-display tracking-widest mb-3">
          {t('home.bettingTable')}
        </h3>

        <div className="flex gap-1 mb-3 bg-secondary rounded-xl p-1">
          {(['latest', 'week', 'month'] as BetTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeBetTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              onClick={() => void switchBetTab(tab)}
            >
              {betTabLabel(tab)}
            </button>
          ))}
        </div>

        {activeBetTab === 'latest' ? (
          <div className="relative overflow-hidden rounded-xl bg-secondary h-[600px]">
            {latestBets.length === 0 ? (
              <div className="space-y-px pt-1">
                {Array.from({ length: 8 }).map((_, n) => (
                  <div key={n} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-10 h-10 rounded-lg animate-pulse bg-white/10 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-28 rounded animate-pulse bg-white/10" />
                      <div className="h-2 w-16 rounded animate-pulse bg-white/10" />
                    </div>
                    <div className="h-3 w-16 rounded animate-pulse bg-white/10" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="animate-scroll-up" style={{ animationDuration: latestBetScrollDuration }}>
                {latestBetsLoop.map((rec, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 active:bg-white/5 transition-colors text-left"
                    onClick={() => onTapGame(rec.uuid)}
                  >
                    {rec.imageUrl ? (
                      <img src={rec.imageUrl} alt={rec.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{localizedGameName(rec, locale)}</p>
                      <p className="text-[10px] text-muted-foreground">{rec.provider}</p>
                    </div>
                    <span className="text-xs font-bold text-primary flex-shrink-0">{formatBet(rec.betAmount, rec.currency)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-secondary overflow-hidden">
            {rankBets.length === 0 ? (
              <div className="space-y-px pt-1">
                {Array.from({ length: 8 }).map((_, n) => (
                  <div key={n} className="flex items-center gap-3 px-3 py-2.5 border-b border-white/5">
                    <div className="w-5 h-5 rounded animate-pulse bg-white/10 flex-shrink-0" />
                    <div className="w-10 h-10 rounded-lg animate-pulse bg-white/10 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-28 rounded animate-pulse bg-white/10" />
                      <div className="h-2 w-16 rounded animate-pulse bg-white/10" />
                    </div>
                    <div className="h-3 w-16 rounded animate-pulse bg-white/10" />
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {rankBets.map((rec, idx) => {
                  const top = idx < 3 ? RANK_TOP_STYLES[idx] : null
                  if (top) {
                    return (
                      <button
                        key={`${rec.uuid}-${idx}`}
                        type="button"
                        className={`relative w-full flex items-center gap-3.5 px-3.5 py-4 border-b active:brightness-110 transition text-left ${top.row}`}
                        onClick={() => onTapGame(rec.uuid)}
                      >
                        <div className="relative flex-shrink-0">
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${top.medal}`}>{idx + 1}</span>
                          {idx === 0 && <Crown size={13} className="absolute -top-2 left-1/2 -translate-x-1/2 rotate-[8deg] text-amber-300 drop-shadow" fill="currentColor" />}
                        </div>
                        {rec.imageUrl ? (
                          <img src={rec.imageUrl} alt={rec.name} className={`w-16 h-16 rounded-xl object-cover flex-shrink-0 bg-white/5 ${top.ring}`} />
                        ) : (
                          <div className={`w-16 h-16 rounded-xl bg-white/10 flex-shrink-0 ${top.ring}`} />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-foreground truncate">{localizedGameName(rec, locale)}</p>
                          <p className="text-[11px] text-muted-foreground">{rec.provider}</p>
                        </div>
                        <span className={`text-base font-black flex-shrink-0 ${top.amount}`}>{formatBet(rec.betAmount, rec.currency)}</span>
                      </button>
                    )
                  }
                  return (
                    <button
                      key={`${rec.uuid}-${idx}`}
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 last:border-0 active:bg-white/5 transition-colors text-left"
                      onClick={() => onTapGame(rec.uuid)}
                    >
                      <span className="w-5 text-center text-xs font-black flex-shrink-0 text-muted-foreground">#{idx + 1}</span>
                      {rec.imageUrl ? (
                        <img src={rec.imageUrl} alt={rec.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">{localizedGameName(rec, locale)}</p>
                        <p className="text-[10px] text-muted-foreground">{rec.provider}</p>
                      </div>
                      <span className="text-xs font-bold text-primary flex-shrink-0">{formatBet(rec.betAmount, rec.currency)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>

  )
}
