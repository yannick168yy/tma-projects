import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Trophy, TrendingUp, Gamepad2, Sparkles, History, Factory,
  Fish, Ticket, Drama, Rocket, X, Gem, Percent,
  Zap, Headphones, ShieldCheck,
} from 'lucide-react'
import GameCardV2 from '@/components/home/GameCardV2'
import TaskFloatBall from '@/components/tasks/TaskFloatBall'
import { INFO_LINKS } from '@/data/home'
import { fetchHomepageGames, fetchGames, fetchGameHistory, launchGame, fetchBettingActivity, type SlotGame, type BetRecord, type BetTab, type GameHistoryItem } from '@/api/slots'
import { fetchHomeContent } from '@/api/home'
import { resolveHomeActionPath } from '@/navigation/appRoutes'
import { ApiError } from '@/api/client'
import { usePromotionStore } from '@/stores/promotion'
import { matchPopupAudience } from '@/api/promotion'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { localizedGameName } from '@/utils/game'
import { analytics } from '@/utils/analytics'
import iconFacebook from '@/assets/team/3-circles/facebook.webp'
import iconTelegram from '@/assets/team/3-circles/telegram.webp'
import iconViber from '@/assets/team/3-circles/viber.webp'
import cashbackFloatImg from '@/assets/home/promos/cashback-float.webp'
import cashRebateBannerImg from '@/assets/home/promos/cash-rebate-banner.webp'
import lossRebateBannerImg from '@/assets/home/promos/loss-rebate-banner.webp'

// 最近在玩区最大展示数，不足时用推荐游戏补齐
const RECENT_ROW_MAX = 10

// 厂商专区：菲市场认知度最高的三家
// code 须与 bg_568win_game.provider 统一后的显示名一致(迁移134)
const PROVIDER_ZONE = [
  { code: 'JILI', label: 'JILI' },
  { code: 'PG Soft', label: 'PG' },
  { code: 'Pragmatic Play', label: 'Pragmatic' },
]

function historyToGame(item: GameHistoryItem): SlotGame {
  return {
    uuid: item.uuid, name: item.name, nameId: item.nameId, nameVi: item.nameVi, nameZh: item.nameZh,
    provider: item.provider, category: null, subCategory: null, sortCategory: null,
    imageUrl: item.imageUrl, imageHqUrl: item.imageHqUrl,
    hasLobby: false, isMobile: true, weight: 0, isFeatured: false,
  }
}

// 官方社群入口（写死，运营账号变更时改这里）；图标复用 team 页面的品牌圆标
const COMMUNITY_LINKS: { label: string; icon: string; url: string }[] = [
  { label: 'Telegram', icon: iconTelegram, url: 'https://telegram.me/betogo_gaming' },
  { label: 'Viber', icon: iconViber, url: 'https://invite.viber.com/?g2=AQBhXJCwtpAV81bXwM93sEjLZsg%2FLSk%2FjwMfIuJNShYEdNkwvHqOqU8AFEFtKo5I' },
  { label: 'Facebook', icon: iconFacebook, url: 'https://www.facebook.com/share/1LPECYxaAS/' },
]
const BET_SCROLL_MIN_DURATION_SECONDS = 32
const BET_SCROLL_SECONDS_PER_ITEM = 2.8

// 首页 banner 来自后台装修配置，只需图片 + 跳转目标
interface HomeBanner { id: number; image: string; target: string }

interface Props {
  onNavigatePath: (path: string) => void
  onOpenCs: () => void
  onOpenGame: (url: string) => void
  onOpenFirstDepositFiesta: () => void
  onOpenCashback: () => void
}

interface HomePromoFloatProps {
  cashbackLabel: string
  onOpenCashback: () => void
}

function HomePromoFloat({ cashbackLabel, onOpenCashback }: HomePromoFloatProps) {
  // 固定悬浮在首页左下角（cashback 在 tasks 下方），不可移动、无展开
  return (
    <div className="pointer-events-none fixed left-2 z-30 select-none" style={{ bottom: 92 }}>
      <button
        type="button"
        className="pointer-events-auto relative flex h-24 w-24 items-center justify-center active:scale-95"
        onClick={onOpenCashback}
        aria-label={cashbackLabel}
      >
        {/* 阴影紧贴图片非透明轮廓一圈（drop-shadow 跟随 alpha） */}
        <img
          src={cashbackFloatImg}
          alt=""
          className="home-cashback-swing-float relative h-[92px] w-[92px] object-contain [filter:drop-shadow(0_0_3px_rgba(0,0,0,0.55))_drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]"
        />
      </button>
    </div>
  )
}

export default function HomeContent({ onNavigatePath, onOpenCs, onOpenGame, onOpenFirstDepositFiesta, onOpenCashback }: Props) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const promotion = usePromotionStore()
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const [homeBanners, setHomeBanners] = useState<HomeBanner[]>([])

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
  const bannerDragRef = useRef({ startX: 0, startY: 0, startScroll: 0, axis: null as 'x'|'y'|null, lastX: 0, lastT: 0 })

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
  // 最近在玩不足最大数时，从推荐里挑未玩过的补齐
  const recentFillGames = useMemo(() => {
    if (recentGames.length === 0 || recentGames.length >= RECENT_ROW_MAX) return []
    const played = new Set(recentGames.map((g) => g.uuid))
    return [...homepageGames.recommended, ...homepageGames.popular]
      .filter((g, i, arr) => !played.has(g.uuid) && arr.findIndex((x) => x.uuid === g.uuid) === i)
      .slice(0, RECENT_ROW_MAX - recentGames.length)
  }, [recentGames, homepageGames.recommended, homepageGames.popular])
  const [providerZoneTab, setProviderZoneTab] = useState(PROVIDER_ZONE[0].code)
  const [providerZoneGames, setProviderZoneGames] = useState<SlotGame[]>([])
  const providerZoneFetchRef = useRef(0)
  // 高 cashback：首页只放最好比例(2%/elite)的 9 款
  const [cashbackGames, setCashbackGames] = useState<SlotGame[]>([])

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

  const onLossRebateBannerTap = useCallback(async () => {
    if (!(await auth.ensureLoggedIn(t('auth.signInBonus')))) return
    onNavigatePath('/vip?tab=lossrebate')
  }, [auth, onNavigatePath, t])

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
  const latestBetScrollDuration = `${Math.max(BET_SCROLL_MIN_DURATION_SECONDS, latestBets.length * BET_SCROLL_SECONDS_PER_ITEM)}s`
  const rankBetScrollDuration = `${Math.max(BET_SCROLL_MIN_DURATION_SECONDS, rankBets.length * BET_SCROLL_SECONDS_PER_ITEM)}s`
  const firstDepositHighlight = promotion.highlights.find((item) => item.promoId === 'firstdep')
  const firstdepPopup = promotion.promoConfig?.popups?.find((p) => p.id === 'firstdep')
  // 后台「首页弹窗」开关+人群控制悬浮球显隐；叠加原有「已充值则不再展示首充」逻辑
  const showFirstDepositFiesta = (firstdepPopup?.enabled ?? true)
    && matchPopupAudience(firstdepPopup?.audience ?? 'all', Boolean(auth.token), firstDepositHighlight?.highlight === false)
    && (!auth.token || firstDepositHighlight?.highlight !== false)

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
    let alive = true
    fetchGames({ cashbackTier: 'elite', limit: 9, sortBy: 'weight', currency: activeCurrency })
      .then((res) => { if (alive) setCashbackGames(res.items) })
      .catch(() => {})
    return () => { alive = false }
  }, [activeCurrency])

  useEffect(() => {
    fetchHomeContent().then((content) => {
      setHomeBanners(content.banners.map((item) => ({
        id: item.slot,
        image: item.imageUrl,
        target: resolveHomeActionPath(item.actionType, item.actionValue),
      })))
    }).catch(() => {})
    if (auth.token && auth.user) void promotion.loadTeamStatus()
  }, [])

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


  return (
    <div className="page-main">
      {/* Banner 轮播（后台装修配置） */}
      {homeBanners.length > 0 && (
        <div className="px-4 mt-2">
          {/* 16:9 跟随屏宽自适应，固定高度在窄屏机会横向裁切图片 */}
          <div className="relative aspect-video overflow-hidden rounded-2xl">
            <div ref={bannerTrackRef} className="banner-carousel flex h-full snap-x snap-mandatory hide-scrollbar" onScroll={onBannerScroll} onTouchStart={onBannerTouchStart} onTouchMove={onBannerTouchMove} onTouchEnd={onBannerTouchEnd} onTouchCancel={onBannerTouchEnd}>
              {homeBanners.map((banner) => (
                <article key={banner.id} className="relative h-full w-full flex-shrink-0 snap-center" onClick={() => navHomeTarget(banner.target)}>
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

      {/* 最近在玩（登录用户）：不足最大数时用推荐游戏补齐，金色竖线分隔；无最近在玩时该区放推荐（小卡） */}
      {recentGames.length > 0 ? (
        <section className="mt-5">
          {sectionHeader(<History size={15} className="text-amber-400" />, t('home.recentPlayed'))}
          <div className="flex items-center gap-2 px-4 overflow-x-auto hide-scrollbar">
            {recentGames.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} size="sm" />)}
            {recentFillGames.length > 0 && (
              <>
                <div className="flex-shrink-0 h-[64px] flex flex-col items-center justify-center gap-1 px-0.5">
                  <span className="w-0.5 flex-1 rounded-full bg-gradient-to-b from-transparent to-amber-400/70" />
                  <span className="w-1.5 h-1.5 rotate-45 bg-amber-400/80 rounded-[2px]" />
                  <span className="w-0.5 flex-1 rounded-full bg-gradient-to-t from-transparent to-amber-400/70" />
                </div>
                {recentFillGames.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} size="sm" />)}
              </>
            )}
          </div>
        </section>
      ) : (
        (gamesLoading || homepageGames.recommended.length > 0) && (
          <section className="mt-5">
            {sectionHeader(<Percent size={15} className="text-red-400" />, t('home.recommended'), () => onNavigatePath('/games'))}
            {smallRow(homepageGames.recommended)}
          </section>
        )
      )}

      {/* Popular：大卡 3x3 */}
      <section className="mt-5">
        {sectionHeader(<TrendingUp size={15} className="text-primary" />, t('home.popularGames'), () => onNavigatePath('/games'))}
        {bigGrid(homepageGames.popular, 12, true)}
      </section>

      {/* Cash Rebate 活动横条 → rebate 页 */}
      <section className="mt-6">
        {sectionHeader(<Percent size={15} className="text-amber-400" />, t('cashback.pageTitle').toUpperCase())}
        <div className="px-4">
          <button type="button" className="relative block w-full active:scale-[0.98] transition-transform" onClick={() => onNavigatePath('/rebate')}>
            <img src={cashRebateBannerImg} alt="Cash Rebate" draggable={false} className="w-full rounded-2xl" />
            {/* ENTER NOW 金条区域流光扫过（区域按图内按钮实测位置定位；rb-shine 自带 position:relative 故外层定位） */}
            <span className="pointer-events-none absolute" style={{ left: '60%', top: '77.5%', right: 0, bottom: '2.5%' }}>
              <span className="rb-shine block h-full w-full rounded-lg" />
            </span>
          </button>
        </div>
      </section>

      {/* 高返水游戏：三档(2%/1.5%/1%)各 3 款 → games 高洗码分类 */}
      {cashbackGames.length > 0 && (
        <section className="mt-6">
          {sectionHeader(<Gem size={15} className="text-amber-400" />, t('home.highRebate'), () => onNavigatePath('/games?cat=highrebate'))}
          <div className="px-4 grid grid-cols-3 gap-x-2 gap-y-3">
            {cashbackGames.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} size="lg" />)}
          </div>
        </section>
      )}

      {/* 高 RTP 专栏：小卡横滑 */}
      {(gamesLoading || homepageGames.highRtp.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Rocket size={15} className="text-yellow-400" />, t('home.highRtp'), () => onNavigatePath('/games?cat=highrtp'))}
          {smallRow(homepageGames.highRtp)}
        </section>
      )}

      {/* 负盈利返水活动横条 → VIP 负盈利返水 tab */}
      <section className="mt-6">
        {sectionHeader(<Percent size={15} className="text-amber-400" />, t('lossRebate.title'))}
        <div className="px-4">
          <button type="button" className="relative block w-full active:scale-[0.98] transition-transform" onClick={() => void onLossRebateBannerTap()}>
            <img src={lossRebateBannerImg} alt="Loss Rebate" draggable={false} className="w-full rounded-2xl" />
          </button>
        </div>
      </section>

      {/* Slots：大卡 3x2 */}
      {(gamesLoading || homepageGames.slots.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Gamepad2 size={15} className="text-violet-400" />, t('home.egamesZone'), () => onNavigatePath('/games?cat=slot'))}
          {bigGrid(homepageGames.slots, 6)}
        </section>
      )}

      {/* 厂商专区：tab + 小卡横滑 */}
      <section className="mt-6">
        {sectionHeader(<Factory size={15} className="text-sky-400" />, t('home.providerZone'), () => onNavigatePath(`/games?provider=${providerZoneTab}`))}
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
          {sectionHeader(<span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />, t('home.casinoZone'), () => onNavigatePath('/games?cat=casino'))}
          {bigGrid(homepageGames.casino, 6)}
        </section>
      )}

      {/* New Games：小卡横滑 */}
      {(gamesLoading || homepageGames.newGames.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Sparkles size={15} className="text-emerald-400" />, t('home.newGames'))}
          {smallRow(homepageGames.newGames)}
        </section>
      )}

      {/* Perya：小卡横滑 */}
      {(gamesLoading || homepageGames.perya.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Drama size={15} className="text-orange-400" />, t('home.peryaZone'), () => onNavigatePath('/games?cat=perya'))}
          {bigGrid(homepageGames.perya, 6)}
        </section>
      )}

      {/* Fishing：大卡 3x2 */}
      {(gamesLoading || homepageGames.fishing.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Fish size={15} className="text-cyan-400" />, t('home.fishingZone'), () => onNavigatePath('/games?cat=fishing'))}
          {bigGrid(homepageGames.fishing, 6)}
        </section>
      )}

      {/* Lottery：小卡横滑 */}
      {(gamesLoading || homepageGames.lottery.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Ticket size={15} className="text-pink-400" />, t('home.lotteryZone'), () => onNavigatePath('/games?cat=lottery'))}
          {bigGrid(homepageGames.lottery.slice(0, 6), 6)}
        </section>
      )}

      {/* 百家乐专栏：小卡横滑 */}
      {(gamesLoading || homepageGames.baccarat.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Gem size={15} className="text-purple-400" />, t('home.baccaratZone'))}
          {smallRow(homepageGames.baccarat)}
        </section>
      )}

      {/* 体育游戏板块：大卡 3 列（USDT 仅 1 款，空则不渲染）*/}
      {(gamesLoading || homepageGames.sports.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Trophy size={15} className="text-green-400" />, t('home.sportsZone'), () => onNavigatePath('/games?cat=sports'))}
          {bigGrid(homepageGames.sports, 6)}
        </section>
      )}


      {/* 推荐精选：有最近在玩时移到投注流上方，大卡 4 行 */}
      {recentGames.length > 0 && (gamesLoading || homepageGames.recommended.length > 0) && (
        <section className="mt-6">
          {sectionHeader(<Percent size={15} className="text-red-400" />, t('home.recommended'), () => onNavigatePath('/games'))}
          {bigGrid(homepageGames.recommended.slice(0, 12), 12)}
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

      {/* 页脚三层：社群(主角) / 品牌介绍+数据(点缀) / 法务收尾 */}
      <footer className="mt-10 border-t border-border/50 pt-14">
        {/* 社群：页脚主角，卡片式大入口 */}
        <section className="px-5">
          <h3 className="text-center font-display text-lg font-black tracking-widest text-foreground">{t('home.communitySection')}</h3>
          <p className="mx-auto mt-3 max-w-[26rem] text-center text-[12px] leading-relaxed text-muted-foreground">{t('home.communitySubtitle')}</p>
          <div className="mt-8 flex justify-center gap-7">
            {COMMUNITY_LINKS.map((link) => (
              <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                className="flex flex-col items-center gap-2.5 transition-transform active:scale-95">
                <img src={link.icon} alt="" className="h-14 w-14" />
                <span className="text-[12px] font-bold text-foreground/90">{link.label}</span>
              </a>
            ))}
          </div>
        </section>

        {/* 品牌介绍 + 数据卡片 */}
        <section className="mt-16 px-6">
          <p className="mx-auto max-w-[30rem] text-center text-[13px] leading-[1.9] text-muted-foreground">{t('home.brandIntroBody')}</p>
          <div className="mx-auto mt-8 grid max-w-[26rem] grid-cols-2 gap-3">
            {[
              { icon: <Gamepad2 size={18} className="text-amber-400" />, v: '2,000+', l: t('home.brandStatGames') },
              { icon: <Factory size={18} className="text-sky-400" />, v: '20+', l: t('home.brandStatProviders') },
              { icon: <Zap size={18} className="text-emerald-400" />, v: t('home.brandStatInstant'), l: t('home.brandStatPayouts') },
              { icon: <Headphones size={18} className="text-primary" />, v: '24/7', l: t('home.brandStatSupport'), onClick: onOpenCs },
            ].map((s) => {
              const inner = (
                <>
                  {s.icon}
                  <p className="mt-2.5 font-display text-base font-black leading-none text-primary">{s.v}</p>
                  <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground">{s.l}</p>
                </>
              )
              const cls = 'flex flex-col items-center rounded-2xl border border-border/60 bg-secondary/50 py-5 text-center'
              return s.onClick
                ? <button key={s.l} type="button" className={`${cls} active:scale-95 transition-transform`} onClick={s.onClick}>{inner}</button>
                : <div key={s.l} className={cls}>{inner}</div>
            })}
          </div>
        </section>

        {/* 法务收尾：徽章 / 合规提示 / 条款 / 版权 */}
        <section className="mt-16 border-t border-border/40 px-6 pb-2 pt-9">
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
              <ShieldCheck size={14} />{t('home.advLicensed')}
            </span>
          </div>
          <p className="mx-auto mt-5 max-w-[30rem] text-center text-[10px] leading-[1.8] text-muted-foreground/70">{t('home.responsibleNote')}</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
            {INFO_LINKS.map((link, i) => (
              <span key={link.key} className="flex items-center gap-2">
                {i > 0 && <span className="text-[11px] text-muted-foreground/30">|</span>}
                <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 active:underline" onClick={() => setInfoModal(link.key)}>
                  {t(`home.info${link.key.charAt(0).toUpperCase() + link.key.slice(1)}`)}
                </button>
              </span>
            ))}
          </div>
          <p className="mb-4 mt-5 text-center text-[10px] text-muted-foreground/50">@2025-2026 BETOGO ALL RIGHTS RESERVED · 21+</p>
        </section>
      </footer>

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
        cashbackLabel={t('cashback.title')}
        onOpenCashback={onOpenCashback}
      />
      <TaskFloatBall onNavigatePath={onNavigatePath} />
    </div>
  )
}
