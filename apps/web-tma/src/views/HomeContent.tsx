import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft, ChevronRight, Trophy, TrendingUp, Gamepad2,
  Headphones, Fish, LayoutGrid, FileText, Shield, Heart, Info, X, Gem,
} from 'lucide-react'
import HomeCategoryShortcut from '@/components/home/HomeCategoryShortcut'
import GameCard from '@/components/home/GameCard'
import EGameCard from '@/components/home/EGameCard'
import LiveCard from '@/components/home/LiveCard'
import { CATEGORIES } from '@/data/categories'
import { BANNERS, WINNERS, INFO_LINKS } from '@/data/home'
import { fetchHomepageGames, fetchGames, fetchProviders, launchGame, fetchBettingActivity, type SlotGame, type BetRecord, type BetTab } from '@/api/slots'
import { ApiError } from '@/api/client'
import { usePromotionStore, getHighlightMap } from '@/stores/promotion'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { localizedGameName } from '@/utils/game'
import chipHotImg from '@/assets/chips/hot.webp'
import chipSlotsImg from '@/assets/chips/slots.png'
import chipLiveImg from '@/assets/chips/live.png'
import chipPokerImg from '@/assets/chips/poker.png'
import chipBingoImg from '@/assets/chips/bingo.png'
import chipSportsImg from '@/assets/chips/sports.png'
import chipFishingImg from '@/assets/chips/fishing.png'

type GameChip = string

interface GameChipDef { id: string; labelKey: string; sortCategory?: string; icon?: string; image?: string }

const OTHER_CATEGORIES = 'other,fantasy,horror,asian,asian-strategy,adventure'

const GAME_CHIPS: GameChipDef[] = [
  { id: 'hot',     image: chipHotImg,     labelKey: 'home.chipHot'    },
  { id: 'slots',   image: chipSlotsImg,   labelKey: 'home.chipSlots',   sortCategory: 'slots'   },
  { id: 'live',    image: chipLiveImg,    labelKey: 'home.chipLive',    sortCategory: 'live'    },
  { id: 'table',   image: chipPokerImg,   labelKey: 'home.chipPoker',   sortCategory: 'table'   },
  { id: 'bingo',   image: chipBingoImg,   labelKey: 'home.chipBingo',   sortCategory: 'bingo'   },
  { id: 'sports',  image: chipSportsImg,  labelKey: 'home.chipSports',  sortCategory: 'sports'  },
  { id: 'fishing', image: chipFishingImg, labelKey: 'home.chipFishing', sortCategory: 'fishing' },
  { id: 'crash',   icon: '🚀', labelKey: 'home.chipCrash',  sortCategory: 'crash'  },
  { id: 'pinoy',   icon: '🐓', labelKey: 'home.chipPinoy',  sortCategory: 'pinoy'  },
  { id: 'other',   icon: '🎮', labelKey: 'home.chipOther',  sortCategory: OTHER_CATEGORIES },
]

const INFO_ICONS: Record<string, React.ComponentType<{ size: number; className?: string }>> = { terms: FileText, privacy: Shield, responsible: Heart, about: Info }

interface CategoryLobbyParams { sortCategory?: string; sortBy?: 'weight' | 'ph_bonus'; title: string }

interface Props {
  onOpenPromo: (promo: string | null) => void
  onOpenCategoryLobby: (params: CategoryLobbyParams) => void
  onOpenCs: () => void
  onOpenGame: (url: string) => void
  onOpenReferralPromo: () => void
}

export default function HomeContent({ onOpenPromo, onOpenCategoryLobby, onOpenCs, onOpenGame, onOpenReferralPromo }: Props) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const promotion = usePromotionStore()
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const highlightMap = useMemo(() => getHighlightMap(), [promotion.highlights])

  const localizedBanners = useMemo(() => BANNERS.map((b) => ({ ...b, tag: t(`home.banners.${b.id}.tag`), title: t(`home.banners.${b.id}.title`), sub: t(`home.banners.${b.id}.sub`), cta: t(`home.banners.${b.id}.cta`) })), [t])

  function onBannerCta(action: string) {
    if (action === 'lobby') {
      onOpenCategoryLobby({ sortBy: 'ph_bonus', title: t('home.popularGames') })
    } else {
      onOpenPromo(action)
    }
  }

  function categoryBadge(promo: string | null, fallback: string | null) {
    if (!promo) return fallback
    const h = highlightMap.get(promo as 'trial' | 'referral' | 'firstdep')
    if (h?.highlight && h.flagLabel) return h.flagLabel
    return fallback
  }
  function categoryClaimable(promo: string | null) {
    if (!promo) return false
    const h = highlightMap.get(promo as 'trial' | 'referral' | 'firstdep')
    return Boolean(h?.highlight)
  }

  // Banner
  const [activeBanner, setActiveBanner] = useState(0)
  const bannerTrackRef = useRef<HTMLDivElement>(null)
  const bannerDragRef = useRef({ startX: 0, startY: 0, startScroll: 0, axis: null as 'x'|'y'|null, lastX: 0, lastT: 0 })
  const marqueeWinners = useMemo(() => [...WINNERS, ...WINNERS], [])

  function onBannerScroll() {
    const el = bannerTrackRef.current; if (!el || el.clientWidth <= 0) return
    setActiveBanner(Math.max(0, Math.min(BANNERS.length - 1, Math.round(el.scrollLeft / el.clientWidth))))
  }
  function scrollToBanner(index: number) {
    const el = bannerTrackRef.current; if (!el) return
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' }); setActiveBanner(index)
  }
  function onBannerTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]; if (!t) return
    bannerDragRef.current = { startX: t.clientX, startY: t.clientY, startScroll: bannerTrackRef.current?.scrollLeft ?? 0, axis: null, lastX: t.clientX, lastT: Date.now() }
  }
  function onBannerTouchMove(e: React.TouchEvent) {
    const el = bannerTrackRef.current; const touch = e.touches[0]; if (!el || !touch) return
    const dx = touch.clientX - bannerDragRef.current.startX; const dy = touch.clientY - bannerDragRef.current.startY
    if (bannerDragRef.current.axis === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) bannerDragRef.current.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    if (bannerDragRef.current.axis !== 'x') return
    e.preventDefault(); el.scrollLeft = bannerDragRef.current.startScroll - dx
    bannerDragRef.current.lastX = touch.clientX; bannerDragRef.current.lastT = Date.now()
  }
  function onBannerTouchEnd() {
    if (bannerDragRef.current.axis === 'x') {
      const el = bannerTrackRef.current; if (el && el.clientWidth > 0) {
        const dx = bannerDragRef.current.startX - bannerDragRef.current.lastX
        const velocity = dx / Math.max(1, Date.now() - bannerDragRef.current.lastT)
        const threshold = el.clientWidth * 0.18; const cur = activeBanner
        if (dx > threshold || velocity > 0.35) { const next = Math.min(BANNERS.length - 1, cur + 1); el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' }); setActiveBanner(next) }
        else if (dx < -threshold || velocity < -0.35) { const prev = Math.max(0, cur - 1); el.scrollTo({ left: prev * el.clientWidth, behavior: 'smooth' }); setActiveBanner(prev) }
        else el.scrollTo({ left: cur * el.clientWidth, behavior: 'smooth' })
      }
    }
    bannerDragRef.current.axis = null
  }

  // Game data
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  const [homepageGames, setHomepageGames] = useState<{ popular: SlotGame[]; slots: SlotGame[]; live: SlotGame[]; fishing: SlotGame[]; crash: SlotGame[]; table: SlotGame[] }>({ popular: [], slots: [], live: [], fishing: [], crash: [], table: [] })
const [gamesLoading, setGamesLoading] = useState(true)
  const popularScroll = useRef<HTMLDivElement>(null); const slotsScroll = useRef<HTMLDivElement>(null)
  const liveScroll = useRef<HTMLDivElement>(null); const fishingScroll = useRef<HTMLDivElement>(null)
  const tableCrashScroll = useRef<HTMLDivElement>(null)
  function scrollRow(ref: React.RefObject<HTMLDivElement | null>, dir: -1 | 1) { ref.current?.scrollBy({ left: dir * 148, behavior: 'smooth' }) }

  const onGameTapAction = useCallback(async (uuid: string) => {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (launchingUuid) return
    setLaunchingUuid(uuid)
    try {
      const { url } = await launchGame(uuid, 'mobile', activeCurrency)
      onOpenGame(url)
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Launch failed') }
    finally { setLaunchingUuid(null) }
  }, [auth, launchingUuid, onOpenGame, t, activeCurrency])

  const popularGames = homepageGames.popular; const slotsGames = homepageGames.slots; const liveGames = homepageGames.live
  const fishingGames = homepageGames.fishing; const tableCrashGames = useMemo(() => [...homepageGames.table, ...homepageGames.crash], [homepageGames])

  // Game chip 筛选
  const [activeChip, setActiveChip] = useState<GameChip>('hot')
  const [activeProvider, setActiveProvider] = useState<string>('all')
  const [chipProviders, setChipProviders] = useState<string[]>([])
  const [chipProvidersLoading, setChipProvidersLoading] = useState(false)
  const [gridGames, setGridGames] = useState<SlotGame[]>([])
  const [gridPage, setGridPage] = useState(1)
  const [gridTotalPages, setGridTotalPages] = useState(1)
  const [gridLoading, setGridLoading] = useState(false)
  const gridSentinelRef = useRef<HTMLDivElement>(null)
  const gridFetchRef = useRef(0)

  async function loadGridPage(chip: GameChip, provider: string, page: number, reset: boolean) {
    const chipDef = GAME_CHIPS.find((c) => c.id === chip)
    if (!chipDef?.sortCategory) return
    const token = ++gridFetchRef.current
    if (reset) setGridLoading(true)
    try {
      const result = await fetchGames({ sortCategory: chipDef.sortCategory, provider: provider === 'all' ? undefined : provider, page, limit: 30, sortBy: 'weight' })
      if (token !== gridFetchRef.current) return
      setGridGames((prev) => reset ? result.items : [...prev, ...result.items])
      setGridPage(result.page)
      setGridTotalPages(result.pages)
    } catch { /* ignore */ }
    finally { if (token === gridFetchRef.current) setGridLoading(false) }
  }

  async function selectChip(chip: GameChip) {
    if (chip === activeChip) return
    setActiveChip(chip)
    setActiveProvider('all')
    setGridGames([])
    if (chip === 'hot') return
    const chipDef = GAME_CHIPS.find((c) => c.id === chip)!
    setChipProvidersLoading(true)
    try {
      const providers = await fetchProviders(chipDef.sortCategory)
      setChipProviders(providers)
    } catch { setChipProviders([]) }
    finally { setChipProvidersLoading(false) }
    void loadGridPage(chip, 'all', 1, true)
  }

  async function selectProvider(provider: string) {
    if (provider === activeProvider) return
    setActiveProvider(provider)
    setGridGames([])
    void loadGridPage(activeChip, provider, 1, true)
  }

  useEffect(() => {
    if (!gridSentinelRef.current || activeChip === 'hot') return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !gridLoading && gridPage < gridTotalPages) {
        void loadGridPage(activeChip, activeProvider, gridPage + 1, false)
      }
    }, { threshold: 0.1 })
    observer.observe(gridSentinelRef.current)
    return () => observer.disconnect()
  }, [activeChip, activeProvider, gridLoading, gridPage, gridTotalPages])

  // Betting table
  const [activeBetTab, setActiveBetTab] = useState<BetTab>('latest')
  const [latestBets, setLatestBets] = useState<BetRecord[]>([]); const [weekBets, setWeekBets] = useState<BetRecord[]>([]); const [monthBets, setMonthBets] = useState<BetRecord[]>([])
  const [betLoaded, setBetLoaded] = useState<Record<BetTab, boolean>>({ latest: false, week: false, month: false })
  function formatBet(amount: number) { return '₱ ' + amount.toLocaleString() }
  async function loadBetTab(tab: BetTab) {
    if (betLoaded[tab]) return; setBetLoaded((prev) => ({ ...prev, [tab]: true }))
    try {
      const data = await fetchBettingActivity(tab)
      if (tab === 'latest') setLatestBets(data); else if (tab === 'week') setWeekBets(data); else setMonthBets(data)
    } catch { /**/ }
  }
  async function switchBetTab(tab: BetTab) { setActiveBetTab(tab); await loadBetTab(tab) }
  const latestBetsLoop = useMemo(() => [...latestBets, ...latestBets], [latestBets])
  const rankBets = activeBetTab === 'week' ? weekBets : monthBets

  function betTabLabel(tab: BetTab) {
    if (tab === 'latest') return t('home.latestBets')
    if (tab === 'week') return t('home.topWeek')
    return t('home.topMonth')
  }

  // Info modal
  const [infoModal, setInfoModal] = useState<string | null>(null)
  const parsedInfoContent = useMemo(() => {
    if (!infoModal) return []
    const text = t(`home.infoDetails.${infoModal}.content`)
    const chunks = text.split('\n\n').map((c) => c.trim()).filter(Boolean)
    const sections: { heading: string | null; body: string }[] = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const isHeading = chunk.length <= 50 && !chunk.includes('\n') && !/[.?!,。，！？]$/.test(chunk)
      if (isHeading && i + 1 < chunks.length) { sections.push({ heading: chunk, body: chunks[i + 1] }); i++ }
      else sections.push({ heading: null, body: chunk })
    }
    return sections
  }, [infoModal, t])

  useEffect(() => {
    setGamesLoading(true)
    fetchHomepageGames().then(setHomepageGames).catch(() => {}).finally(() => setGamesLoading(false))
    void loadBetTab('latest')
    if (auth.token && auth.user) void promotion.loadTeamStatus()
  }, [])

  const providerList = ['JILI', 'PGSOFT', 'PRAGMATIC', 'BGAMING', 'EVOLUTION', 'HABANERO', 'NOLIMIT', 'NETENT', 'POPIPLAY', 'SPRIBE', 'BOOONGO']

  return (
    <div className="page-main">
      {/* Category shortcuts */}
      <div className="category-shortcut-row flex gap-3 px-4 pb-3 pt-3 overflow-x-auto hide-scrollbar">
        {CATEGORIES.map((c) => (
          <HomeCategoryShortcut key={c.id} category={c} claimable={categoryClaimable(c.promo)} claimLabel={categoryBadge(c.promo, c.badge)} onClick={() => onOpenPromo(c.promo)} />
        ))}
      </div>

      {/* Banner carousel */}
      <div className="px-4">
        <div className="relative h-56 overflow-hidden rounded-2xl">
          <div ref={bannerTrackRef} className="banner-carousel flex h-full snap-x snap-mandatory hide-scrollbar" onScroll={onBannerScroll} onTouchStart={onBannerTouchStart} onTouchMove={onBannerTouchMove} onTouchEnd={onBannerTouchEnd} onTouchCancel={onBannerTouchEnd}>
            {localizedBanners.map((banner) => (
              <article key={banner.id} className="relative h-56 w-full flex-shrink-0 snap-center">
                <div className={`absolute inset-0 bg-gradient-to-br ${banner.gradient}`} />
                <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-white/5" />
                <div className="absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-white/5" />
                <div className="absolute inset-0 flex flex-col justify-between p-4">
                  <div className="flex items-start justify-between">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${banner.badgeColor}`}>{banner.tag}</span>
                    <span className="text-3xl">{banner.badge}</span>
                  </div>
                  <div>
                    <h2 className="mb-1 whitespace-pre-line font-display text-[1.55rem] font-black leading-tight text-white">{banner.title}</h2>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-white/70">{banner.sub}</p>
                      <button
                        type="button"
                        className="flex-shrink-0 rounded-full bg-white/15 backdrop-blur-sm border border-white/30 px-3 py-1 text-[11px] font-black text-white active:scale-95 transition-transform"
                        onClick={() => onBannerCta(banner.ctaAction)}
                      >
                        {banner.cta}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {BANNERS.map((_, i) => (
              <button key={i} type="button" className={`pointer-events-auto h-1.5 rounded-full transition-all ${i === activeBanner ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`} onClick={() => scrollToBanner(i)} />
            ))}
          </div>
        </div>
      </div>

      {/* Game type chip 条 — 实物 emoji 无底色 */}
      <div className="mt-4 border-b border-white/5">
        <div className="flex gap-0.5 px-2 overflow-x-auto hide-scrollbar snap-x snap-mandatory">
          {GAME_CHIPS.map((chip) => {
            const active = activeChip === chip.id
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => void selectChip(chip.id)}
                className="relative flex-shrink-0 snap-start flex flex-col items-center gap-0.5 px-2.5 pt-2 pb-0 min-w-[58px] active:scale-95 transition-transform"
              >
                {active && (
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 bottom-0 rounded-t-lg"
                    style={{ background: 'linear-gradient(180deg, rgba(220,38,38,0.28) 0%, rgba(220,38,38,0.06) 55%, transparent 100%)' }}
                  />
                )}
                {chip.image ? (
                  <img
                    src={chip.image}
                    alt=""
                    draggable={false}
                    className={`relative h-9 w-9 object-contain select-none transition-transform ${active ? 'scale-105' : ''}`}
                    style={{ filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.45))' }}
                  />
                ) : (
                  <span
                    className={`relative text-[34px] leading-none select-none transition-transform ${active ? 'scale-105' : ''}`}
                    style={{ filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.45))' }}
                  >
                    {chip.icon}
                  </span>
                )}
                <span className={`relative text-[11px] font-semibold leading-tight pb-2.5 ${active ? 'text-red-400' : 'text-foreground/75'}`}>
                  {t(chip.labelKey)}
                </span>
                <span
                  className={`absolute bottom-0 left-1 right-1 h-[3px] rounded-full transition-opacity ${active ? 'bg-red-500 opacity-100' : 'opacity-0'}`}
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* 非 Hot 模式：二级 provider 筛选 + 游戏 grid */}
      {activeChip !== 'hot' && (
        <>
          {/* Provider chip 条 */}
          <div className="flex gap-2 px-4 mt-3 overflow-x-auto hide-scrollbar">
            {chipProvidersLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex-shrink-0 h-7 w-16 rounded-full animate-pulse bg-secondary" />
                ))
              : (
                <>
                  <button
                    type="button"
                    onClick={() => void selectProvider('all')}
                    className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-colors active:scale-95 ${
                      activeProvider === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'
                    }`}
                  >
                    All
                  </button>
                  {chipProviders.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void selectProvider(p)}
                      className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-colors active:scale-95 ${
                        activeProvider === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </>
              )
            }
          </div>

          {/* 游戏 3列 grid */}
          <div className="px-3 mt-4 grid grid-cols-3 gap-2">
            {gridLoading && gridGames.length === 0
              ? Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-[8/11] rounded-xl animate-pulse bg-secondary" />
                ))
              : gridGames.map((g) => (
                  <EGameCard key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} className="w-full aspect-[8/11] rounded-xl overflow-hidden active:scale-95 transition-transform" />
                ))
            }
          </div>

          {/* 加载更多 skeleton */}
          {gridLoading && gridGames.length > 0 && (
            <div className="px-3 mt-2 grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="aspect-[8/11] rounded-xl animate-pulse bg-secondary" />
              ))}
            </div>
          )}

          {/* IntersectionObserver 哨兵 */}
          <div ref={gridSentinelRef} className="h-4" />

          {/* 已到底 */}
          {!gridLoading && gridPage >= gridTotalPages && gridGames.length > 0 && (
            <p className="text-center text-[11px] text-muted-foreground py-4">{t('common.noMore')}</p>
          )}
        </>
      )}

      {/* Hot 模式：原有首页内容 */}
      {activeChip === 'hot' && <>

      {/* Recent Wins marquee */}
      <div className="mx-4 mt-4 bg-secondary rounded-xl p-3 flex items-center gap-2 overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-1.5 text-primary"><Trophy size={13} /><span className="text-xs font-bold uppercase tracking-wide whitespace-nowrap">{t('home.recentWins')}</span></div>
        <div className="w-px h-4 bg-border flex-shrink-0" />
        <div className="overflow-hidden flex-1">
          <div className="flex gap-6 animate-marquee whitespace-nowrap">
            {marqueeWinners.map((w, i) => <span key={i} className="text-xs text-foreground/80 flex-shrink-0"><span className="text-primary font-bold">{w.name}</span> {t('common.won')} <span className="text-emerald-400 font-bold">{w.amount}</span> · <span className="text-muted-foreground">{w.game}</span></span>)}
          </div>
        </div>
      </div>

      {/* Popular Games */}
      <section className="mt-5">
        <div className="flex items-center justify-between px-4 mb-3">
          <div className="flex items-center gap-2"><TrendingUp size={15} className="text-primary" /><h3 className="text-foreground font-black text-sm font-display">{t('home.popularGames')}</h3></div>
          <div className="flex items-center gap-2">
            <button type="button" className="h-6 px-2 flex items-center rounded-full bg-secondary text-primary text-[10px] font-bold active:scale-90 transition-transform" onClick={() => onOpenCategoryLobby({ sortBy: 'ph_bonus', title: t('home.popularGames') })}>ALL</button>
            <div className="flex items-center gap-0.5">
              <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(popularScroll, -1)}><ChevronLeft size={13} /></button>
              <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(popularScroll, 1)}><ChevronRight size={13} /></button>
            </div>
          </div>
        </div>
        {gamesLoading ? <div className="flex gap-3 px-4">{Array.from({length:6}).map((_,i)=><div key={i} className="flex-shrink-0 w-32 h-40 animate-pulse rounded-xl bg-secondary"/>)}</div>
          : popularGames.length > 0 && <div ref={popularScroll} className="flex gap-3 px-4 overflow-x-auto hide-scrollbar">{popularGames.map((g)=><div key={g.uuid} className="flex-shrink-0 w-32"><GameCard game={g} onTap={()=>void onGameTapAction(g.uuid)} /></div>)}</div>}
      </section>

      {/* E-Games Zone (slots) */}
      {(gamesLoading || slotsGames.length > 0) && (
        <section className="mt-6">
          <div className="flex items-center justify-between px-4 mb-3">
            <div className="flex items-center gap-2"><Gamepad2 size={15} className="text-violet-400" /><h3 className="text-foreground font-black text-sm font-display">{t('home.egamesZone')}</h3><span className="bg-violet-500/20 text-violet-300 text-[10px] font-bold px-2 py-0.5 rounded-full">{t('common.featured')}</span></div>
            <div className="flex items-center gap-2">
              <button type="button" className="h-6 px-2 flex items-center rounded-full bg-secondary text-primary text-[10px] font-bold active:scale-90 transition-transform" onClick={() => onOpenCategoryLobby({ sortCategory: 'slots', sortBy: 'weight', title: t('home.egamesZone') })}>ALL</button>
              <div className="flex items-center gap-0.5">
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(slotsScroll, -1)}><ChevronLeft size={13} /></button>
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(slotsScroll, 1)}><ChevronRight size={13} /></button>
              </div>
            </div>
          </div>
          {gamesLoading ? <div className="flex gap-3 px-4">{Array.from({length:6}).map((_,i)=><div key={i} className="flex-shrink-0 w-32 h-28 animate-pulse rounded-xl bg-secondary"/>)}</div>
            : <div ref={slotsScroll} className="flex gap-3 px-4 overflow-x-auto hide-scrollbar">{slotsGames.map((g)=><EGameCard key={g.uuid} game={g} onTap={()=>void onGameTapAction(g.uuid)} />)}</div>}
        </section>
      )}

      {/* Live Games */}
      {(gamesLoading || liveGames.length > 0) && (
        <section className="mt-6">
          <div className="flex items-center justify-between px-4 mb-3">
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><h3 className="text-foreground font-black text-sm font-display">{t('home.liveGames')}</h3></div>
            <div className="flex items-center gap-2">
              <button type="button" className="h-6 px-2 flex items-center rounded-full bg-secondary text-primary text-[10px] font-bold active:scale-90 transition-transform" onClick={() => onOpenCategoryLobby({ sortCategory: 'live', sortBy: 'weight', title: t('home.liveGames') })}>ALL</button>
              <div className="flex items-center gap-0.5">
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(liveScroll, -1)}><ChevronLeft size={13} /></button>
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(liveScroll, 1)}><ChevronRight size={13} /></button>
              </div>
            </div>
          </div>
          {gamesLoading ? <div className="flex gap-3 px-4">{Array.from({length:6}).map((_,i)=><div key={i} className="flex-shrink-0 w-32 h-28 animate-pulse rounded-xl bg-secondary"/>)}</div>
            : <div ref={liveScroll} className="flex gap-3 px-4 overflow-x-auto hide-scrollbar">{liveGames.map((g)=><LiveCard key={g.uuid} game={g} onTap={()=>void onGameTapAction(g.uuid)} />)}</div>}
        </section>
      )}

      {/* Fishing Games */}
      {(gamesLoading || fishingGames.length > 0) && (
        <section className="mt-6">
          <div className="flex items-center justify-between px-4 mb-3">
            <div className="flex items-center gap-2"><Fish size={15} className="text-cyan-400" /><h3 className="text-foreground font-black text-sm font-display">{t('home.fishingZone')}</h3></div>
            <div className="flex items-center gap-2">
              <button type="button" className="h-6 px-2 flex items-center rounded-full bg-secondary text-primary text-[10px] font-bold active:scale-90 transition-transform" onClick={() => onOpenCategoryLobby({ sortCategory: 'fishing', sortBy: 'weight', title: t('home.fishingZone') })}>ALL</button>
              <div className="flex items-center gap-0.5">
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(fishingScroll, -1)}><ChevronLeft size={13} /></button>
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(fishingScroll, 1)}><ChevronRight size={13} /></button>
              </div>
            </div>
          </div>
          {gamesLoading ? <div className="flex gap-3 px-4">{Array.from({length:6}).map((_,i)=><div key={i} className="flex-shrink-0 w-32 h-28 animate-pulse rounded-xl bg-secondary"/>)}</div>
            : <div ref={fishingScroll} className="flex gap-3 px-4 overflow-x-auto hide-scrollbar">{fishingGames.map((g)=><EGameCard key={g.uuid} game={g} onTap={()=>void onGameTapAction(g.uuid)} />)}</div>}
        </section>
      )}

      {/* Table & Crash */}
      {(gamesLoading || tableCrashGames.length > 0) && (
        <section className="mt-6">
          <div className="flex items-center justify-between px-4 mb-3">
            <div className="flex items-center gap-2"><LayoutGrid size={15} className="text-blue-400" /><h3 className="text-foreground font-black text-sm font-display">{t('home.tableZone')}</h3></div>
            <div className="flex items-center gap-2">
              <button type="button" className="h-6 px-2 flex items-center rounded-full bg-secondary text-primary text-[10px] font-bold active:scale-90 transition-transform" onClick={() => onOpenCategoryLobby({ sortCategory: 'table', sortBy: 'weight', title: t('home.tableZone') })}>ALL</button>
              <div className="flex items-center gap-0.5">
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(tableCrashScroll, -1)}><ChevronLeft size={13} /></button>
                <button type="button" className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform" onClick={() => scrollRow(tableCrashScroll, 1)}><ChevronRight size={13} /></button>
              </div>
            </div>
          </div>
          {gamesLoading ? <div className="flex gap-3 px-4">{Array.from({length:6}).map((_,i)=><div key={i} className="flex-shrink-0 w-32 h-28 animate-pulse rounded-xl bg-secondary"/>)}</div>
            : <div ref={tableCrashScroll} className="flex gap-3 px-4 overflow-x-auto hide-scrollbar">{tableCrashGames.map((g)=><EGameCard key={g.uuid} game={g} onTap={()=>void onGameTapAction(g.uuid)} />)}</div>}
        </section>
      )}

      {/* Providers */}
      <section className="mt-8 px-4">
        <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black mb-3">
          {t('home.providersSection')}
        </p>
        <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {providerList.map((p) => (
            <span
              key={p}
              className="flex-shrink-0 text-[10px] font-black text-muted-foreground bg-secondary px-3 py-1.5 rounded-full border border-border"
            >
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* Betting Table */}
      <section className="mt-8 px-4">
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
              <div className="animate-scroll-up">
                {latestBetsLoop.map((rec, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 active:bg-white/5 transition-colors text-left"
                    onClick={() => void onGameTapAction(rec.uuid)}
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
                    <span className="text-xs font-bold text-primary flex-shrink-0">{formatBet(rec.betAmount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-secondary overflow-hidden h-[600px]">
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
              rankBets.map((rec, idx) => (
                <button
                  key={rec.uuid}
                  type="button"
                  className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 last:border-0 active:bg-white/5 transition-colors text-left"
                  onClick={() => void onGameTapAction(rec.uuid)}
                >
                  <span
                    className={`w-5 text-center text-xs font-black flex-shrink-0 ${idx === 0 ? 'text-primary' : idx === 1 ? 'text-white/50' : idx === 2 ? 'text-amber-600' : 'text-muted-foreground'}`}
                  >
                    #{idx + 1}
                  </span>
                  {rec.imageUrl ? (
                    <img src={rec.imageUrl} alt={rec.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">{localizedGameName(rec, locale)}</p>
                    <p className="text-[10px] text-muted-foreground">{rec.provider}</p>
                  </div>
                  <span className="text-xs font-bold text-primary flex-shrink-0">{formatBet(rec.betAmount)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </section>

      {/* Info Links */}
      <section className="mt-6 px-4">
        <h3 className="text-muted-foreground font-black text-xs font-display tracking-widest mb-3">{t('home.infoSection')}</h3>
        <div className="grid grid-cols-2 gap-3">
          {INFO_LINKS.map((link) => {
            const IconComp = INFO_ICONS[link.key]
            const iconColors: Record<string, { bg: string; text: string }> = { terms: { bg: 'bg-amber-500/15', text: 'text-amber-400' }, privacy: { bg: 'bg-blue-500/15', text: 'text-blue-400' }, responsible: { bg: 'bg-rose-500/15', text: 'text-rose-400' }, about: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' } }
            const colors = iconColors[link.key] ?? { bg: 'bg-secondary', text: 'text-muted-foreground' }
            return (
              <button key={link.key} type="button" className="bg-secondary border border-border rounded-2xl p-4 text-left flex flex-col gap-3 active:scale-95 transition-transform" onClick={() => setInfoModal(link.key)}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${colors.bg}`}>{IconComp && <IconComp size={16} className={colors.text} />}</div>
                <div className="flex items-end justify-between gap-1 flex-1">
                  <p className="text-xs font-bold text-foreground leading-snug">{t(`home.info${link.key.charAt(0).toUpperCase() + link.key.slice(1)}`)}</p>
                  <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Info Modal */}
      {infoModal && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setInfoModal(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-card rounded-t-2xl max-h-[82vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <h2 className="font-display font-black text-base text-foreground">{t(`home.infoDetails.${infoModal}.title`)}</h2>
              <button type="button" className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center" onClick={() => setInfoModal(null)}><X size={15} className="text-muted-foreground" /></button>
            </div>
            <div className="overflow-y-auto px-5 py-5 space-y-4">
              {parsedInfoContent.map((s, i) => (
                <div key={i}>
                  {s.heading && <p className="text-primary font-black font-display text-[11px] uppercase tracking-widest mb-1.5 border-l-2 border-primary pl-2.5">{s.heading}</p>}
                  <p className="text-[13px] text-foreground/70 leading-relaxed whitespace-pre-line">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Support */}
      <section className="mt-8 px-4">
        <h3 className="text-muted-foreground font-black text-xs font-display tracking-widest mb-3">{t('home.supportSection')}</h3>
        <button type="button" className="w-full bg-secondary rounded-xl p-4 flex items-center justify-between border border-border" onClick={onOpenCs}>
          <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0"><Headphones size={16} className="text-primary" /></div><span className="text-sm font-bold text-foreground">{t('home.supportOnline')}</span></div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
      </section>
      <div className="mt-6 mb-4 px-4 text-center"><p className="text-[10px] text-muted-foreground/50">© 2025 BetoGo · 18+</p></div>

      </>}{/* end hot mode */}

      {/* 三级分销浮动挂件：未成为代理前始终显示，成为代理后自动消失 */}
      {auth.token && !promotion.teamStatus?.isAgent && (
        <div className="fixed bottom-24 right-4 z-30 flex flex-col items-end gap-1.5">
          <span className="absolute inset-0 rounded-2xl animate-ping bg-amber-400/30 pointer-events-none" style={{ animationDuration: '2.4s' }} />
          <button
            type="button"
            onClick={onOpenReferralPromo}
            className="relative flex items-center gap-2 px-3 py-2 rounded-2xl shadow-lg active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(135deg, #ffb800 0%, #ff7a00 100%)', boxShadow: '0 4px 20px rgba(255,184,0,0.45)' }}
          >
            <Gem size={16} className="text-amber-900 flex-shrink-0" />
            <span className="text-[12px] font-black text-amber-950 whitespace-nowrap">{t('referralPromo.widget')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
