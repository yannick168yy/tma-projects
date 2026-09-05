import { getSiteName } from '@/config/brand'
import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Gamepad2, History, Factory, X, Gem, Percent,
  Zap, Headphones, ShieldCheck,
} from 'lucide-react'
import GameCardV2 from '@/components/home/GameCardV2'
import BannerCarousel, { type HomeBanner } from '@/components/home/BannerCarousel'
import BettingTable from '@/components/home/BettingTable'
import { GAME_SECTIONS, GameSectionBlock } from '@/components/home/gameSections'
import { DEFAULT_BLOCK_ORDER } from '@/components/home/blockOrder'
import TaskFloatBall from '@/components/tasks/TaskFloatBall'
import { INFO_LINKS } from '@/data/home'
import { fetchHomepageGames, fetchGames, fetchGameHistory, launchGame, type SlotGame, type GameHistoryItem, type HomeSection } from '@/api/slots'
import { fetchHomeContent } from '@/api/home'
import type { AnnouncementContents } from '@/api/announcements'
import { resolveHomeActionPath } from '@/navigation/appRoutes'
import AnnouncementBar from '@/components/AnnouncementBar'
import { ApiError } from '@/api/client'
import { usePromotionStore } from '@/stores/promotion'
import { matchPopupAudience } from '@/api/promotion'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { analytics } from '@/utils/analytics'
import iconFacebook from '@/assets/team/3-circles/facebook.webp'
import iconTelegram from '@/assets/team/3-circles/telegram.webp'
import iconViber from '@/assets/team/3-circles/viber.webp'
import cashbackFloatImg from '@/assets/home/promos/cashback-float.webp'
import cashRebateBannerImg from '@/assets/home/promos/cash-rebate-banner.webp'
import lossRebateBannerImg from '@/assets/home/promos/loss-rebate-banner.webp'
import { localizedImage } from '@/utils/localizedImage'

// 最近在玩区最大展示数，不足时用推荐游戏补齐
const RECENT_ROW_MAX = 10


// 厂商专区（TOP PROVIDERS）
// code 须与 bg_568win_game.provider 统一后的显示名一致(迁移134)
const PROVIDER_ZONE = [
  { code: 'JILI', label: 'JILI' },
  { code: 'PG Soft', label: 'PG' },
  { code: 'Pragmatic Play', label: 'Pragmatic' },
  { code: 'CQ9', label: 'CQ9' },
  { code: 'FaChai', label: 'FaChai' },
  { code: 'Playtech', label: 'Playtech' },
  { code: '5G Games', label: '5G' },
  { code: '568WinGames', label: '568Win' },
]
// 厂商专区每页展示数；多拉一些做「已出现在首页的游戏跳过 + 同名去重」后再截取
const PROVIDER_ZONE_SHOW = 12
const PROVIDER_ZONE_FETCH = 48 // 拉多些兜底:过滤掉维护中游戏后仍尽量填满 12

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

// 榜单前三名的金/银/铜华丽配色

// 首页 banner 来自后台装修配置，只需图片 + 跳转目标

interface Props {
  homeBannerTopAnnouncement?: AnnouncementContents
  onNavigatePath: (path: string) => void
  onOpenCs: () => void
  onOpenGame: (url: string) => void
  onOpenFirstDepositFiesta: () => void
  onOpenCashback: () => void
  onOpenDeposit: () => void
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

export default function HomeContent({ homeBannerTopAnnouncement, onNavigatePath, onOpenCs, onOpenGame, onOpenFirstDepositFiesta, onOpenCashback, onOpenDeposit }: Props) {
  const { t, i18n } = useTranslation()
  const cashRebateBanner = localizedImage(cashRebateBannerImg, i18n.language, 'cash-rebate-banner.webp')
  const lossRebateBanner = localizedImage(lossRebateBannerImg, i18n.language, 'loss-rebate-banner.webp')
  const locale = i18n.language
  const promotion = usePromotionStore()
  const auth = useAuthStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const [homeBanners, setHomeBanners] = useState<HomeBanner[]>([])

  // 首页装修配置的统一跳转：充值窗口是弹窗特判，内部路由走 navigate，外链走 window.open，空串不跳转
  function navHomeTarget(target: string) {
    if (!target) return
    if (target === '/deposit') {
      onOpenDeposit()
      return
    }
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer')
      return
    }
    onNavigatePath(target)
  }


  // Game data
  const emptyHomepage = { popular: [], recommended: [], newGames: [], slots: [], casino: [], perya: [], fishing: [], lottery: [], baccarat: [], highRtp: [], highRebate: [], sports: [] }
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  const [homepageGames, setHomepageGames] = useState<Record<keyof typeof emptyHomepage, SlotGame[]>>(emptyHomepage)
  // 后台「首页板块配置」按币种隐藏的板块：整块不渲染（内容仍会下发，只是不展示）
  const [hiddenSections, setHiddenSections] = useState<string[]>([])
  const shown = (key: keyof typeof emptyHomepage) => !hiddenSections.includes(key)
  // 后台「首页布局」下发的区块顺序与参数；没下发(老缓存/接口失败)时退回默认顺序 + 隐藏名单
  const [serverSections, setServerSections] = useState<HomeSection[]>([])
  const homeLayout = useMemo<HomeSection[]>(() => (
    serverSections.length
      ? serverSections
      : DEFAULT_BLOCK_ORDER.filter((k) => !hiddenSections.includes(k)).map((key) => ({ key }))
  ), [serverSections, hiddenSections])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [recentGames, setRecentGames] = useState<SlotGame[]>([])
  // 最近在玩不足最大数时补齐：只从推荐候选池第 13 款起取（前 12 由推荐板块展示、
  // popular 有自己的板块），保证补位游戏不与首页其他板块重复
  const recentFillGames = useMemo(() => {
    if (recentGames.length === 0 || recentGames.length >= RECENT_ROW_MAX) return []
    const played = new Set(recentGames.map((g) => g.uuid))
    return homepageGames.recommended.slice(12)
      .filter((g) => !played.has(g.uuid))
      .slice(0, RECENT_ROW_MAX - recentGames.length)
  }, [recentGames, homepageGames.recommended])
  // 推荐板块展示：剔除「最近在玩」行已出现的游戏后取前 12
  const recommendedDisplay = useMemo(() => {
    const shown = new Set([...recentGames, ...recentFillGames].map((g) => g.uuid))
    return homepageGames.recommended.filter((g) => !shown.has(g.uuid)).slice(0, 12)
  }, [homepageGames.recommended, recentGames, recentFillGames])
  const [providerZoneTab, setProviderZoneTab] = useState(PROVIDER_ZONE[0].code)
  const [providerZoneRaw, setProviderZoneRaw] = useState<SlotGame[]>([])
  const providerZoneFetchRef = useRef(0)
  // TOP PROVIDERS 最后筛选：跳过已出现在其他首页板块的游戏，模块内同名游戏只留一款
  const homepageShownUuids = useMemo(() => {
    const s = new Set<string>()
    Object.values(homepageGames).forEach((list) => list.forEach((g) => s.add(g.uuid)))
    return s
  }, [homepageGames])
  const providerZoneGames = useMemo(() => {
    const names = new Set<string>()
    return providerZoneRaw.filter((g) => {
      if (g.isAvailable === false) return false // 厂商专区:剔除维护/下线游戏(不置灰,直接不显示)
      if (homepageShownUuids.has(g.uuid)) return false
      const key = (g.name ?? '').trim().toLowerCase()
      if (key && names.has(key)) return false
      if (key) names.add(key)
      return true
    }).slice(0, PROVIDER_ZONE_SHOW)
  }, [providerZoneRaw, homepageShownUuids])
  // 高 cashback：首页只放最好比例(2%/elite)的 9 款

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
      .then((data) => {
        setHomepageGames({
          popular: data.popular ?? [], recommended: data.recommended ?? [], newGames: data.newGames ?? [], slots: data.slots ?? [], casino: data.casino ?? [],
          perya: data.perya ?? [], fishing: data.fishing ?? [], lottery: data.lottery ?? [], baccarat: data.baccarat ?? [], highRtp: data.highRtp ?? [], highRebate: data.highRebate ?? [], sports: data.sports ?? [],
        })
        setHiddenSections(data.hiddenSections ?? [])
        setServerSections(data.sections ?? [])
      })
      .catch(() => {})
      .finally(() => setGamesLoading(false))
  }, [activeCurrency])

  useEffect(() => {
    if (!auth.token) { setRecentGames([]); return }
    fetchGameHistory(10).then((items) => setRecentGames(items.map(historyToGame))).catch(() => {})
  }, [auth.token])

  useEffect(() => {
    const token = ++providerZoneFetchRef.current
    fetchGames({ provider: providerZoneTab, limit: PROVIDER_ZONE_FETCH, sortBy: 'weight', currency: activeCurrency })
      .then((res) => { if (token === providerZoneFetchRef.current) setProviderZoneRaw(res.items) })
      .catch(() => {})
  }, [providerZoneTab, activeCurrency])

  useEffect(() => {
    fetchHomeContent(i18n.language).then((content) => {
      setHomeBanners(content.banners.map((item) => ({
        id: item.slot,
        image: item.imageUrl,
        target: resolveHomeActionPath(item.actionType, item.actionValue),
      })))
    }).catch(() => {})
    if (auth.token && auth.user) void promotion.loadTeamStatus()
  }, [i18n.language])

  // 投注流非首屏关键，进入视口前不拉，避免与首页游戏/内容抢首屏带宽


  // ── 首页区块渲染表 ──────────────────────────────────────────────────────────
  // 顺序 / 显示隐藏 / 每块参数由后台「首页布局」下发（/slots/homepage 的 sections 字段）。
  // 服务端总会下发 sections（buildSectionList 按 HOME_LAYOUT_SECTIONS 全量生成），
  // 拿不到只可能是老缓存或接口失败，那时退回 DEFAULT_BLOCK_ORDER。


  // 游戏块全部由注册表生成（GAME_SECTIONS）；下面这张表只剩「长得都不一样」的运营块。
  // 加一个游戏专区改 gameSections.tsx 一行，不用再照抄一段 JSX。
  const gameBlocks = useMemo<Record<string, (s: HomeSection) => React.ReactNode>>(() => (
    Object.fromEntries(GAME_SECTIONS.map((spec) => [spec.key, (s: HomeSection) => (
      <GameSectionBlock
        spec={spec}
        section={s}
        games={spec.dataKey === 'recommendedDisplay' ? recommendedDisplay : homepageGames[spec.dataKey]}
        loading={gamesLoading}
        // 「推荐精选」大卡只在最近在玩占了上方那行时出现，否则 recentPlayed 已经放过推荐小卡
        enabled={spec.key === 'recommended' ? recentGames.length > 0 : true}
        t={t}
        onTap={(uuid) => void onGameTapAction(uuid)}
        onNavigate={onNavigatePath}
      />
    )]))
  ), [homepageGames, recommendedDisplay, gamesLoading, recentGames.length, t, onGameTapAction, onNavigatePath])

  const blocks: Record<string, (s: HomeSection) => React.ReactNode> = {
    ...gameBlocks,
    announcement: () => homeBannerTopAnnouncement && (
      <div className="px-4 pt-2">
        <AnnouncementBar contents={homeBannerTopAnnouncement} tone="general" />
      </div>
    ),
    banner: () => <BannerCarousel banners={homeBanners} onTap={navHomeTarget} />,
    // 最近在玩（登录用户）：不足最大数时用推荐游戏补齐，金色竖线分隔；
    // 无最近在玩时该区改放推荐小卡 —— 所以隐藏 recommended 会同时关掉这个兜底
    recentPlayed: () => recentGames.length > 0 ? (
        <section className="mt-5">
          {sectionHeader(<History size={15} className="text-amber-400" />, t('home.recentPlayed'))}
          <div className="flex items-center gap-2 px-4 overflow-x-auto hide-scrollbar">
            {recentGames.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} size="sm" />)}
            {recentFillGames.length > 0 && (
              <>
                <div className="flex-shrink-0 h-[64px] flex items-center justify-center px-0.5">
                  <span className="w-0.5 h-full rounded-full bg-gradient-to-b from-transparent via-amber-400/70 to-transparent" />
                </div>
                {recentFillGames.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => void onGameTapAction(g.uuid)} size="sm" />)}
              </>
            )}
          </div>
        </section>
      ) : (
        shown('recommended') && (gamesLoading || homepageGames.recommended.length > 0) && (
          <section className="mt-5">
            {sectionHeader(<Percent size={15} className="text-red-400" />, t('home.recommended'), () => onNavigatePath('/games'))}
            {smallRow(recommendedDisplay)}
          </section>
        )
      ),
    // Cash Rebate 活动横条 → rebate 页
    cashRebate: () => (
      <section className="mt-6">
        {sectionHeader(<Percent size={15} className="text-amber-400" />, t('cashback.pageTitle').toUpperCase())}
        <div className="px-4">
          <button type="button" className="relative block w-full active:scale-[0.98] transition-transform" onClick={() => onNavigatePath('/rebate')}>
            <img src={cashRebateBanner} alt="Cash Rebate" draggable={false} className="w-full rounded-2xl" />
            {/* ENTER NOW 金条区域流光扫过（区域按图内按钮实测位置定位；rb-shine 自带 position:relative 故外层定位） */}
            <span className="pointer-events-none absolute" style={{ left: '60%', top: '77.5%', right: 0, bottom: '2.5%' }}>
              <span className="rb-shine block h-full w-full rounded-lg" />
            </span>
          </button>
        </div>
      </section>
    ),
    // 负盈利返水活动横条 → VIP 负盈利返水 tab
    lossRebate: () => (
      <section className="mt-6">
        {sectionHeader(<Percent size={15} className="text-amber-400" />, t('lossRebate.title'))}
        <div className="px-4">
          <button type="button" className="relative block w-full active:scale-[0.98] transition-transform" onClick={() => void onLossRebateBannerTap()}>
            <img src={lossRebateBanner} alt="Loss Rebate" draggable={false} className="w-full rounded-2xl" />
          </button>
        </div>
      </section>
    ),
    // 厂商专区：tab + 小卡横滑
    providerZone: (s) => (
      <section className="mt-6">
        {sectionHeader(<Factory size={15} className="text-sky-400" />, t('home.providerZone'), () => onNavigatePath(`/games?provider=${providerZoneTab}`))}
        <div className="flex gap-2 px-4 mb-3 overflow-x-auto hide-scrollbar">
          {PROVIDER_ZONE.map((p) => (
            <button
              key={p.code}
              type="button"
              onClick={() => setProviderZoneTab(p.code)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-colors active:scale-95 ${providerZoneTab === p.code ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {smallRow(s.limit ? providerZoneGames.slice(0, s.limit) : providerZoneGames, providerZoneGames.length === 0)}
      </section>
    ),
    bettingTable: () => (
      <BettingTable currency={activeCurrency} locale={locale} t={t} onTapGame={(uuid) => void onGameTapAction(uuid)} />
    ),
  }

  // 加了区块却忘了排进兜底顺序（或反之）只会表现为「某块偶尔不出现」，
  // 极难在测试环境复现，所以在开发期直接吵出来
  if (import.meta.env.DEV) {
    const missing = DEFAULT_BLOCK_ORDER.filter((k) => !blocks[k])
    const unordered = Object.keys(blocks).filter((k) => !DEFAULT_BLOCK_ORDER.includes(k as typeof DEFAULT_BLOCK_ORDER[number]))
    if (missing.length || unordered.length) {
      console.error('[home] 区块表与兜底顺序不一致', { 顺序里没有对应区块: missing, 区块没排进顺序: unordered })
    }
  }

  return (
    <div className="page-main">
      {homeLayout.map((s) => <Fragment key={s.key}>{blocks[s.key]?.(s)}</Fragment>)}

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
          <p className="mb-4 mt-5 text-center text-[10px] text-muted-foreground/50">@2025-2026 {getSiteName()} ALL RIGHTS RESERVED</p>
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
