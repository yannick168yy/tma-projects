import { useState, useEffect, useRef, useMemo, useCallback, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight, Trophy, TrendingUp, Gamepad2, Sparkles, History, Factory,
  Fish, Dice5, Ticket, Drama, Rocket, X, Gem, Percent,
} from 'lucide-react'
import HomeCategoryShortcut from '@/components/home/HomeCategoryShortcut'
import GameCardV2 from '@/components/home/GameCardV2'
import { WINNERS, INFO_LINKS } from '@/data/home'
import { fetchHomepageGames, fetchGames, fetchProviders, fetchGameHistory, launchGame, fetchBettingActivity, type SlotGame, type BetRecord, type BetTab, type GameHistoryItem } from '@/api/slots'
import { fetchHomeContent } from '@/api/home'
import { resolveHomeActionPath } from '@/navigation/appRoutes'
import { ApiError } from '@/api/client'
import { usePromotionStore } from '@/stores/promotion'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { localizedGameName } from '@/utils/game'
import { analytics } from '@/utils/analytics'
import chipHotImg from '@/assets/chips/hot.webp'
import chipSlotsImg from '@/assets/chips/slots.png'
import chipLiveImg from '@/assets/chips/live.png'
import chipPokerImg from '@/assets/chips/poker.png'
import chipBingoImg from '@/assets/chips/bingo.png'
import chipSportsImg from '@/assets/chips/sports.png'
import chipFishingImg from '@/assets/chips/fishing.png'
import infoTermsImg from '@/assets/home/info-support/infor01.webp'
import infoPrivacyImg from '@/assets/home/info-support/infor02.webp'
import infoResponsibleImg from '@/assets/home/info-support/infor03.webp'
import infoAboutImg from '@/assets/home/info-support/infor04.webp'
import supportOnlineImg from '@/assets/home/info-support/online01.webp'
import rewardsSpinFloatImg from '@/assets/home/promos/rewards-spin-float.webp'
import cashbackFloatImg from '@/assets/home/promos/cashback-float.webp'
import yellowExpandUpImg from '@/assets/home/promos/yellow-expand-up.webp'
import yellowCollapseDownImg from '@/assets/home/promos/yellow-collapse-down.webp'
import { shortProviderName } from '@/utils/providers'

type GameChip = string

interface GameChipDef { id: string; labelKey: string; siteCategory?: string; icon?: string; image?: string }

// 分类切到 site_category（同步时按 new_game_type + 名称关键词推导，后台可人工覆盖）
const GAME_CHIPS: GameChipDef[] = [
  { id: 'hot',     image: chipHotImg,     labelKey: 'home.chipHot'    },
  { id: 'slot',    image: chipSlotsImg,   labelKey: 'home.chipSlots',   siteCategory: 'slot'    },
  { id: 'casino',  image: chipLiveImg,    labelKey: 'home.chipCasino',  siteCategory: 'casino'  },
  { id: 'fishing', image: chipFishingImg, labelKey: 'home.chipFishing', siteCategory: 'fishing' },
  { id: 'perya',   icon: '🐓', labelKey: 'home.chipPerya',   siteCategory: 'perya'   },
  { id: 'lottery', image: chipBingoImg,   labelKey: 'home.chipLottery', siteCategory: 'lottery' },
  { id: 'poker',   image: chipPokerImg,   labelKey: 'home.chipPoker',   siteCategory: 'poker'   },
  { id: 'sports',  image: chipSportsImg,  labelKey: 'home.chipSports',  siteCategory: 'sports'  },
  { id: 'other',   icon: '🎮', labelKey: 'home.chipOther',   siteCategory: 'other'   },
]

// 厂商专区：菲市场认知度最高的三家
const PROVIDER_ZONE = [
  { code: 'JiLiGaming', label: 'JILI' },
  { code: 'PGSoft', label: 'PG' },
  { code: 'PragmaticPlay', label: 'Pragmatic' },
]

const WIN568_SPORTSBOOK_UUID = '568win:sportsbook'

function historyToGame(item: GameHistoryItem): SlotGame {
  return {
    uuid: item.uuid, name: item.name, nameId: item.nameId, nameVi: item.nameVi, nameZh: item.nameZh,
    provider: item.provider, category: null, subCategory: null, sortCategory: null,
    imageUrl: item.imageUrl, imageHqUrl: item.imageHqUrl,
    hasDemo: false, hasLobby: false, isMobile: true, weight: 0, phBonus: 0, isFeatured: false, theme: null,
  }
}

const INFO_ICONS: Record<string, string> = { terms: infoTermsImg, privacy: infoPrivacyImg, responsible: infoResponsibleImg, about: infoAboutImg }

interface CategoryLobbyParams { sortCategory?: string; siteCategory?: string; provider?: string; sortBy?: 'weight' | 'ph_bonus'; title: string }

// 首页 banner / 小卡片均来自后台装修配置，只需图片 + 跳转目标
interface HomeBanner { id: number; image: string; target: string }
interface HomeCard { slot: number; image: string; target: string }

interface Props {
  onNavigatePath: (path: string) => void
  onOpenCategoryLobby: (params: CategoryLobbyParams) => void
  onOpenCs: () => void
  onOpenGame: (url: string) => void
  onOpenFirstDepositFiesta: () => void
  onOpenRewardsSpin: () => void
  onOpenCashback: () => void
}

interface HomePromoFloatProps {
  rewardsLabel: string
  cashbackLabel: string
  onOpenRewardsSpin: () => void
  onOpenCashback: () => void
}

let homePromoFloatClosedUntilReload = false

function HomePromoFloat({ rewardsLabel, cashbackLabel, onOpenRewardsSpin, onOpenCashback }: HomePromoFloatProps) {
  const widgetRef = useRef<HTMLDivElement>(null)
  const collapsedPositionRef = useRef<{ left: number; top: number } | null>(null)
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, startLeft: 0, startTop: 0, moved: false, suppressClick: false })
  const [expanded, setExpanded] = useState(false)
  const [activePromo, setActivePromo] = useState(0)
  const [closed, setClosed] = useState(homePromoFloatClosedUntilReload)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const promos = [
    { key: 'cashback', label: 'cashback', ariaLabel: cashbackLabel, image: cashbackFloatImg, imageClass: 'home-cashback-swing-float', action: onOpenCashback },
    { key: 'rewards', label: 'rewards', ariaLabel: rewardsLabel, image: rewardsSpinFloatImg, imageClass: 'home-rewards-spin-float', action: onOpenRewardsSpin },
  ]

  const clampPosition = useCallback((left: number, top: number) => {
    const el = widgetRef.current
    const width = el?.offsetWidth ?? 112
    const height = el?.offsetHeight ?? (expanded ? 290 : 146)
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    const minLeft = frameLeft + 8
    const maxLeft = Math.max(minLeft, frameLeft + frameWidth - width - 8)
    const minTop = 72
    const maxTop = Math.max(minTop, viewportHeight - height - 92)
    return {
      left: Math.min(Math.max(left, minLeft), maxLeft),
      top: Math.min(Math.max(top, minTop), maxTop),
    }
  }, [expanded])

  const defaultPosition = useCallback(() => {
    const el = widgetRef.current
    const height = el?.offsetHeight ?? (expanded ? 290 : 146)
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    return clampPosition(frameLeft + 8, viewportHeight - height - 96)
  }, [clampPosition, expanded])

  useEffect(() => {
    const syncPosition = () => {
      setPosition((current) => {
        const next = current ?? defaultPosition()
        return clampPosition(next.left, next.top)
      })
    }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    return () => window.removeEventListener('resize', syncPosition)
  }, [clampPosition, defaultPosition])

  useEffect(() => {
    if (expanded) return
    const timer = window.setInterval(() => setActivePromo((current) => (current + 1) % promos.length), 5000)
    return () => window.clearInterval(timer)
  }, [expanded, promos.length])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-float-control]')) return
    const current = position ?? defaultPosition()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: current.left,
      startTop: current.top,
      moved: false,
      suppressClick: false,
    }
    setPosition(current)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    drag.moved = true
    setPosition(clampPosition(drag.startLeft + dx, drag.startTop + dy))
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag.pointerId !== event.pointerId) return
    drag.suppressClick = drag.moved
    if (drag.moved) window.setTimeout(() => { dragRef.current.suppressClick = false }, 0)
    drag.pointerId = -1
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function runAction(action: () => void) {
    if (dragRef.current.suppressClick) {
      dragRef.current.suppressClick = false
      return
    }
    action()
  }

  function toggleExpanded() {
    if (expanded) {
      if (collapsedPositionRef.current) setPosition(collapsedPositionRef.current)
      setExpanded(false)
      return
    }
    collapsedPositionRef.current = position
    setExpanded(true)
  }

  function closeFloat() {
    homePromoFloatClosedUntilReload = true
    setClosed(true)
  }

  const visiblePromos = expanded ? promos : [promos[activePromo]]
  if (closed) return null

  return (
    <div
      ref={widgetRef}
      className={`fixed z-30 flex touch-none select-none flex-col items-center gap-1.5 px-1.5 pb-1.5 pt-12 ${expanded ? 'rounded-full bg-neutral-950/70' : ''}`}
      style={position ? { left: position.left, top: position.top } : { left: 8, bottom: 96 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <button
        type="button"
        data-float-control
        className="absolute left-1/2 top-0 h-6 w-6 -translate-x-1/2 active:scale-95"
        onClick={toggleExpanded}
        aria-label={expanded ? 'Collapse' : 'Expand'}
      >
        <img src={expanded ? yellowCollapseDownImg : yellowExpandUpImg} alt="" className="h-full w-full object-contain drop-shadow-[0_4px_12px_rgba(255,184,0,0.55)]" />
      </button>
      {expanded && (
        <button
          type="button"
          data-float-control
          className="absolute right-1 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white/85 shadow-[0_4px_12px_rgba(0,0,0,0.35)] active:scale-95"
          onClick={closeFloat}
          aria-label="Close"
        >
          <X size={14} strokeWidth={3} />
        </button>
      )}
      {expanded ? (
        visiblePromos.map((promo) => (
          <button
            key={promo.key}
            type="button"
            className="flex w-[106px] flex-col items-center gap-0.5 active:scale-95"
            onClick={() => runAction(promo.action)}
            aria-label={promo.ariaLabel}
          >
            <img src={promo.image} alt="" className={`${promo.imageClass} h-[94px] w-[94px] object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.38)]`} />
            <span className="text-xs font-black leading-none text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">{promo.label}</span>
          </button>
        ))
      ) : (
        <div className="w-[106px] overflow-hidden">
          <div className="flex transition-transform duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ transform: `translateX(-${activePromo * 106}px)` }}>
            {promos.map((promo) => (
              <button
                key={promo.key}
                type="button"
                className="flex h-[100px] w-[106px] flex-shrink-0 items-center justify-center active:scale-95"
                onClick={() => runAction(promo.action)}
                aria-label={promo.ariaLabel}
              >
                <img src={promo.image} alt="" className={`${promo.imageClass} h-[99px] w-[99px] object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.38)]`} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function HomeContent({ onNavigatePath, onOpenCategoryLobby, onOpenCs, onOpenGame, onOpenFirstDepositFiesta, onOpenRewardsSpin, onOpenCashback }: Props) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const promotion = usePromotionStore()
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const [homeBanners, setHomeBanners] = useState<HomeBanner[]>([])
  const [homeCards, setHomeCards] = useState<HomeCard[]>([])

  // 首页装修配置的统一跳转：内部路由走 navigate，外链走 window.open，空串不跳转
  function navHomeTarget(target: string) {
    if (!target) return
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer')
      return
    }
    onNavigatePath(target)
  }

  // Banner
  const [activeBanner, setActiveBanner] = useState(0)
  const bannerTrackRef = useRef<HTMLDivElement>(null)
  const cardTrackRef = useRef<HTMLDivElement>(null)
  const bannerDragRef = useRef({ startX: 0, startY: 0, startScroll: 0, axis: null as 'x'|'y'|null, lastX: 0, lastT: 0 })
  const marqueeWinners = useMemo(() => Array.from({ length: 24 }, (_, i) => WINNERS[i % WINNERS.length]), [])

  function onBannerScroll() {
    const el = bannerTrackRef.current; if (!el || el.clientWidth <= 0) return
    setActiveBanner(Math.max(0, Math.min(homeBanners.length - 1, Math.round(el.scrollLeft / el.clientWidth))))
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
        if (dx > threshold || velocity > 0.35) { const next = Math.min(homeBanners.length - 1, cur + 1); el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' }); setActiveBanner(next) }
        else if (dx < -threshold || velocity < -0.35) { const prev = Math.max(0, cur - 1); el.scrollTo({ left: prev * el.clientWidth, behavior: 'smooth' }); setActiveBanner(prev) }
        else el.scrollTo({ left: cur * el.clientWidth, behavior: 'smooth' })
      }
    }
    bannerDragRef.current.axis = null
  }

  useEffect(() => {
    if (homeBanners.length <= 1) return
    const id = setInterval(() => {
      setActiveBanner((cur) => {
        const next = (cur + 1) % homeBanners.length
        const el = bannerTrackRef.current
        if (el && el.clientWidth > 0) el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
        return next
      })
    }, 3500)
    return () => clearInterval(id)
  }, [homeBanners.length])

  // Game data
  const emptyHomepage = { popular: [], recommended: [], newGames: [], slots: [], casino: [], perya: [], fishing: [], lottery: [], baccarat: [], highRtp: [], sports: [] }
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  const [homepageGames, setHomepageGames] = useState<Record<keyof typeof emptyHomepage, SlotGame[]>>(emptyHomepage)
  const [gamesLoading, setGamesLoading] = useState(true)
  const [recentGames, setRecentGames] = useState<SlotGame[]>([])
  const [providerZoneTab, setProviderZoneTab] = useState(PROVIDER_ZONE[0].code)
  const [providerZoneGames, setProviderZoneGames] = useState<SlotGame[]>([])
  const providerZoneFetchRef = useRef(0)

  const onGameTapAction = useCallback(async (uuid: string) => {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    if (launchingUuid) return
    setLaunchingUuid(uuid)
    try {
      const { url } = await launchGame(uuid, 'mobile', activeCurrency)
      analytics.gameLaunch('real', uuid, activeCurrency, 'home')
      onOpenGame(url)
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Launch failed') }
    finally { setLaunchingUuid(null) }
  }, [auth, launchingUuid, onOpenGame, t, activeCurrency])


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
    if (!chipDef?.siteCategory) return
    const token = ++gridFetchRef.current
    if (reset) setGridLoading(true)
    try {
      const result = await fetchGames({ siteCategory: chipDef.siteCategory, provider: provider === 'all' ? undefined : provider, page, limit: 30, sortBy: 'weight', currency: activeCurrency })
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
      const providers = await fetchProviders(undefined, chipDef.siteCategory)
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
  const betSectionRef = useRef<HTMLElement>(null)
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
  const rankBetsLoop = useMemo(() => [...rankBets, ...rankBets], [rankBets])
  const latestBetScrollDuration = `${Math.max(56, latestBets.length * 4.8)}s`
  const rankBetScrollDuration = `${Math.max(56, rankBets.length * 4.8)}s`
  const firstDepositHighlight = promotion.highlights.find((item) => item.promoId === 'firstdep')
  const showFirstDepositFiesta = !auth.token || firstDepositHighlight?.highlight !== false

  // ── 板块渲染辅助：大卡=3列固定网格，小卡=单行横滑 ──
  function sectionHeader(icon: React.ReactNode, title: string, onAll?: () => void) {
    return (
      <div className="flex items-center justify-between px-4 mb-3">
        <div className="flex items-center gap-2">{icon}<h3 className="text-foreground font-black text-sm font-display">{title}</h3></div>
        {onAll && <button type="button" className="h-6 px-2 flex items-center rounded-full bg-secondary text-primary text-[10px] font-bold active:scale-90 transition-transform" onClick={onAll}>{t('common.viewAll')}</button>}
      </div>
    )
  }

  function bigGrid(games: SlotGame[], skeletonCount: number, showHot = false) {
    if (gamesLoading) {
      return (
        <div className="px-4 grid grid-cols-3 gap-x-2 gap-y-3">
          {Array.from({ length: skeletonCount }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-xl bg-secondary" />)}
        </div>
      )
    }
    return (
      <div className="px-4 grid grid-cols-3 gap-x-2 gap-y-3">
        {games.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} size="lg" showHot={showHot} />)}
      </div>
    )
  }

  function smallRow(games: SlotGame[], loading = gamesLoading) {
    if (loading) {
      return (
        <div className="flex gap-2 px-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="flex-shrink-0 w-[76px] h-[76px] animate-pulse rounded-xl bg-secondary" />)}
        </div>
      )
    }
    return (
      <div className="flex gap-2 px-4 overflow-x-auto hide-scrollbar">
        {games.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} size="sm" />)}
      </div>
    )
  }

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
    fetchHomepageGames(activeCurrency)
      .then((data) => setHomepageGames({
        popular: data.popular ?? [], recommended: data.recommended ?? [], newGames: data.newGames ?? [], slots: data.slots ?? [], casino: data.casino ?? [],
        perya: data.perya ?? [], fishing: data.fishing ?? [], lottery: data.lottery ?? [], baccarat: data.baccarat ?? [], highRtp: data.highRtp ?? [], sports: data.sports ?? [],
      }))
      .catch(() => {})
      .finally(() => setGamesLoading(false))
  }, [activeCurrency])

  useEffect(() => {
    if (!auth.token) { setRecentGames([]); return }
    fetchGameHistory(10).then((items) => setRecentGames(items.map(historyToGame))).catch(() => {})
  }, [auth.token])

  useEffect(() => {
    const token = ++providerZoneFetchRef.current
    fetchGames({ provider: providerZoneTab, limit: 12, sortBy: 'weight', currency: activeCurrency })
      .then((res) => { if (token === providerZoneFetchRef.current) setProviderZoneGames(res.items) })
      .catch(() => {})
  }, [providerZoneTab, activeCurrency])

  useEffect(() => {
    fetchHomeContent().then((content) => {
      setHomeBanners(content.banners.map((item) => ({
        id: item.slot,
        image: item.imageUrl,
        target: resolveHomeActionPath(item.actionType, item.actionValue),
      })))
      setHomeCards(content.cards.map((item) => ({
        slot: item.slot,
        image: item.imageUrl,
        target: resolveHomeActionPath(item.actionType, item.actionValue),
      })))
    }).catch(() => {})
    if (auth.token && auth.user) void promotion.loadTeamStatus()
  }, [])

  useEffect(() => {
    if (activeChip === 'hot') return
    setGridGames([])
    void loadGridPage(activeChip, activeProvider, 1, true)
  }, [activeCurrency])

  // 投注流非首屏关键，进入视口前不拉，避免与首页游戏/内容抢首屏带宽
  useEffect(() => {
    const el = betSectionRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void loadBetTab('latest')
        observer.disconnect()
      }
    }, { threshold: 0.1, rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (cardTrackRef.current) cardTrackRef.current.scrollLeft = 0
  }, [homeCards])


  return (
    <div className="page-main">
      {/* Banner 轮播（后台装修配置） */}
      {homeBanners.length > 0 && (
        <div className="px-4 mt-2">
          <div className="relative h-56 overflow-hidden rounded-2xl">
            <div ref={bannerTrackRef} className="banner-carousel flex h-full snap-x snap-mandatory hide-scrollbar" onScroll={onBannerScroll} onTouchStart={onBannerTouchStart} onTouchMove={onBannerTouchMove} onTouchEnd={onBannerTouchEnd} onTouchCancel={onBannerTouchEnd}>
              {homeBanners.map((banner) => (
                <article key={banner.id} className="relative h-56 w-full flex-shrink-0 snap-center" onClick={() => navHomeTarget(banner.target)}>
                  <img src={banner.image} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
                </article>
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
              {homeBanners.map((_, i) => (
                <button key={i} type="button" className={`pointer-events-auto h-1.5 rounded-full transition-all ${i === activeBanner ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`} onClick={() => scrollToBanner(i)} />
              ))}
            </div>
          </div>
        </div>
      )}

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
                      {shortProviderName(p)}
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
                  <div key={i} className="aspect-square rounded-xl animate-pulse bg-secondary" />
                ))
              : gridGames.map((g) => (
                  <GameCardV2 key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} size="lg" />
                ))
            }
          </div>

          {/* 加载更多 skeleton */}
          {gridLoading && gridGames.length > 0 && (
            <div className="px-3 mt-2 grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl animate-pulse bg-secondary" />
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
          <div className="flex w-max animate-marquee whitespace-nowrap" style={{ animationDuration: '96s' }}>
            {[0, 1].map((group) => (
              <div key={group} className="flex flex-shrink-0 gap-6 pr-6">
                {marqueeWinners.map((w, i) => <span key={`${group}-${i}`} className="text-xs text-foreground/80 flex-shrink-0"><span className="text-primary font-bold">{w.name}</span> {t('common.won')} <span className="text-emerald-400 font-bold">{w.amount}</span> · <span className="text-muted-foreground">{w.game}</span></span>)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 最近在玩（登录用户） */}
      {recentGames.length > 0 && (
        <section className="mt-5">
          {sectionHeader(<History size={15} className="text-amber-400" />, t('home.recentPlayed'))}
          {smallRow(recentGames, false)}
        </section>
      )}

      {/* Popular：大卡 3x3 */}
      <section className="mt-5">
        {sectionHeader(<TrendingUp size={15} className="text-primary" />, t('home.popularGames'), () => onOpenCategoryLobby({ sortBy: 'ph_bonus', title: t('home.popularGames') }))}
        {bigGrid(homepageGames.popular, 12, true)}
      </section>

      {/* 推荐精选：竞品验证权重的次高梯队，大卡 */}
      {(gamesLoading || homepageGames.recommended.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Percent size={15} className="text-red-400" />, t('home.recommended'), () => onOpenCategoryLobby({ sortBy: 'weight', title: t('home.recommended') }))}
          {bigGrid(homepageGames.recommended, 6)}
        </section>
      )}

      {/* New Games：小卡横滑 */}
      {(gamesLoading || homepageGames.newGames.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Sparkles size={15} className="text-emerald-400" />, t('home.newGames'))}
          {smallRow(homepageGames.newGames)}
        </section>
      )}

      {/* Slots：大卡 3x2 */}
      {(gamesLoading || homepageGames.slots.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Gamepad2 size={15} className="text-violet-400" />, t('home.egamesZone'), () => onOpenCategoryLobby({ siteCategory: 'slot', sortBy: 'weight', title: t('home.egamesZone') }))}
          {bigGrid(homepageGames.slots, 6)}
        </section>
      )}

      {/* 厂商专区：tab + 小卡横滑 */}
      <section className="mt-6">
        {sectionHeader(<Factory size={15} className="text-sky-400" />, t('home.providerZone'), () => onOpenCategoryLobby({ provider: providerZoneTab, sortBy: 'weight', title: t('home.providerZone') }))}
        <div className="flex gap-2 px-4 mb-3">
          {PROVIDER_ZONE.map((p) => (
            <button
              key={p.code}
              type="button"
              onClick={() => setProviderZoneTab(p.code)}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors active:scale-95 ${providerZoneTab === p.code ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {smallRow(providerZoneGames, providerZoneGames.length === 0)}
      </section>

      {/* Casino：大卡 3x2 */}
      {(gamesLoading || homepageGames.casino.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />, t('home.casinoZone'), () => onOpenCategoryLobby({ siteCategory: 'casino', sortBy: 'weight', title: t('home.casinoZone') }))}
          {bigGrid(homepageGames.casino, 6)}
        </section>
      )}

      {/* Perya：小卡横滑 */}
      {(gamesLoading || homepageGames.perya.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Drama size={15} className="text-orange-400" />, t('home.peryaZone'), () => onOpenCategoryLobby({ siteCategory: 'perya', sortBy: 'weight', title: t('home.peryaZone') }))}
          {bigGrid(homepageGames.perya, 6)}
        </section>
      )}

      {/* Fishing：大卡 3x2 */}
      {(gamesLoading || homepageGames.fishing.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Fish size={15} className="text-cyan-400" />, t('home.fishingZone'), () => onOpenCategoryLobby({ siteCategory: 'fishing', sortBy: 'weight', title: t('home.fishingZone') }))}
          {bigGrid(homepageGames.fishing, 6)}
        </section>
      )}

      {/* Lottery：小卡横滑 */}
      {(gamesLoading || homepageGames.lottery.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Ticket size={15} className="text-pink-400" />, t('home.lotteryZone'), () => onOpenCategoryLobby({ siteCategory: 'lottery', sortBy: 'weight', title: t('home.lotteryZone') }))}
          {bigGrid(homepageGames.lottery, 12)}
        </section>
      )}

      {/* 百家乐专栏：小卡横滑 */}
      {(gamesLoading || homepageGames.baccarat.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Gem size={15} className="text-purple-400" />, t('home.baccaratZone'))}
          {smallRow(homepageGames.baccarat)}
        </section>
      )}

      {/* 高 RTP 专栏：小卡横滑 */}
      {(gamesLoading || homepageGames.highRtp.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Rocket size={15} className="text-yellow-400" />, t('home.highRtp'))}
          {smallRow(homepageGames.highRtp)}
        </section>
      )}

      {/* 体育游戏板块：大卡 3 列（USDT 仅 1 款，空则不渲染）*/}
      {(gamesLoading || homepageGames.sports.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Trophy size={15} className="text-green-400" />, t('home.sportsZone'), () => onOpenCategoryLobby({ siteCategory: 'sports', sortBy: 'weight', title: t('home.sportsZone') }))}
          {/* Sportsbook 体育投注入口，归属体育板块 */}
          <div className="px-4 mb-3">
            <button
              type="button"
              className="w-full flex items-center justify-between rounded-2xl px-5 py-4 active:scale-[0.98] transition-transform"
              style={{ background: 'linear-gradient(120deg, #14532d 0%, #166534 55%, #15803d 100%)' }}
              onClick={() => void onGameTapAction(WIN568_SPORTSBOOK_UUID)}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"><Dice5 size={20} className="text-white" /></div>
                <div className="text-left">
                  <p className="text-sm font-black text-white font-display">{t('home.sportsEntry')}</p>
                  <p className="text-[11px] text-white/70">{t('home.sportsEntrySub')}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-white/80" />
            </button>
          </div>
          {bigGrid(homepageGames.sports, 6)}
        </section>
      )}


      {/* Betting Table */}
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
              <div className="animate-scroll-up" style={{ animationDuration: rankBetScrollDuration }}>
                {rankBetsLoop.map((rec, idx) => (
                <button
                  key={`${rec.uuid}-${idx}`}
                  type="button"
                  className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 last:border-0 active:bg-white/5 transition-colors text-left"
                  onClick={() => void onGameTapAction(rec.uuid)}
                >
                  <span
                    className={`w-5 text-center text-xs font-black flex-shrink-0 ${idx % rankBets.length === 0 ? 'text-primary' : idx % rankBets.length === 1 ? 'text-white/50' : idx % rankBets.length === 2 ? 'text-amber-600' : 'text-muted-foreground'}`}
                  >
                    #{idx % rankBets.length + 1}
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
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 首页彩色小卡片（后台装修配置） */}
      {homeCards.length > 0 && (
        <section className="mt-6">
          <div ref={cardTrackRef} className="category-shortcut-row flex gap-3 pl-4 pr-4 pb-2 overflow-x-auto hide-scrollbar scroll-ps-4">
            {homeCards.map((c) => (
              <HomeCategoryShortcut key={c.slot} image={c.image} onClick={() => navHomeTarget(c.target)} />
            ))}
          </div>
        </section>
      )}

      {/* Info Links */}
      <section className="mt-6 px-4">
        <h3 className="text-muted-foreground font-black text-xs font-display tracking-widest mb-3">{t('home.infoSection')}</h3>
        <div className="grid grid-cols-2 gap-3">
          {INFO_LINKS.map((link) => {
            const iconImage = INFO_ICONS[link.key]
            const iconColors: Record<string, string> = { terms: 'bg-amber-500/15', privacy: 'bg-blue-500/15', responsible: 'bg-rose-500/15', about: 'bg-emerald-500/15' }
            const iconBg = iconColors[link.key] ?? 'bg-secondary'
            return (
              <button key={link.key} type="button" className="bg-secondary border border-border rounded-2xl p-4 text-left flex flex-col gap-3 active:scale-95 transition-transform" onClick={() => setInfoModal(link.key)}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden ${iconBg}`}>{iconImage && <img src={iconImage} alt="" className="h-7 w-7 rounded-md object-contain" />}</div>
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
          <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0 overflow-hidden"><img src={supportOnlineImg} alt="" className="h-7 w-7 rounded-md object-contain" /></div><span className="text-sm font-bold text-foreground">{t('home.supportOnline')}</span></div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
      </section>
      <div className="mt-6 mb-4 px-4 text-center"><p className="text-[10px] text-muted-foreground/50">© 2025 BetoGo · 18+</p></div>

      </>}{/* end hot mode */}

      {/* First Deposit Fiesta floating entry */}
      {showFirstDepositFiesta && (
        <div className="fixed bottom-24 right-4 z-30 flex flex-col items-end gap-1.5">
          <span className="absolute inset-0 rounded-2xl animate-ping bg-amber-400/30 pointer-events-none" style={{ animationDuration: '2.4s' }} />
          <button
            type="button"
            onClick={onOpenFirstDepositFiesta}
            className="relative flex items-center gap-2 px-3 py-2 rounded-2xl shadow-lg active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(135deg, #ffb800 0%, #ff7a00 100%)', boxShadow: '0 4px 20px rgba(255,184,0,0.45)' }}
          >
            <Gem size={16} className="text-amber-900 flex-shrink-0" />
            <span className="text-[12px] font-black text-amber-950 whitespace-nowrap">{t('bonuses.promos.firstdep.title')}</span>
          </button>
        </div>
      )}

      <HomePromoFloat
        rewardsLabel={t('category.rewardsSpin')}
        cashbackLabel={t('cashback.title')}
        onOpenRewardsSpin={onOpenRewardsSpin}
        onOpenCashback={onOpenCashback}
      />
    </div>
  )
}
