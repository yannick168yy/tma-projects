import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import GameCardV2 from '@/components/home/GameCardV2'
import { fetchGames, fetchProviders, launchGame, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { analytics } from '@/utils/analytics'

interface CategoryDef { id: string; labelKey: string; siteCategory?: string }

// 一级分类：All + 高洗码 + site_category（纯文字 tab，对齐 casinoplus）；顺序与首页 chip 一致
const CATEGORIES: CategoryDef[] = [
  { id: 'all',        labelKey: 'games.catAll'         },
  { id: 'highrebate', labelKey: 'games.catHighRebate'  },
  { id: 'slot',    labelKey: 'home.chipSlots',   siteCategory: 'slot'    },
  { id: 'casino',  labelKey: 'home.chipCasino',  siteCategory: 'casino'  },
  { id: 'perya',   labelKey: 'home.chipPerya',   siteCategory: 'perya'   },
  { id: 'poker',   labelKey: 'home.chipPoker',   siteCategory: 'poker'   },
  { id: 'fishing', labelKey: 'home.chipFishing', siteCategory: 'fishing' },
  { id: 'sports',  labelKey: 'home.chipSports',  siteCategory: 'sports'  },
  { id: 'lottery', labelKey: 'home.chipLottery', siteCategory: 'lottery' },
  { id: 'other',   labelKey: 'home.chipOther',   siteCategory: 'other'   },
]

// 高 cashback 二级档位子菜单：All(混合) + elite=2% / pro=1.5% / basic=1%
type RebateTier = 'all' | 'elite' | 'pro' | 'basic'
const TIER_TABS: { id: RebateTier; labelKey?: string; label?: string }[] = [
  { id: 'all',   labelKey: 'games.catAll' },
  { id: 'elite', label: '2% cashback' },
  { id: 'pro',   label: '1.5% cashback' },
  { id: 'basic', label: '1% cashback' },
]

interface Props {
  cat: string
  provider: string
  onChangeFilter: (filter: { cat: string; provider: string }) => void
  onOpenPerya: () => void
  onGameTap: () => void
  onOpenGame: (url: string) => void
}

export default function GamesPage({ cat, provider, onChangeFilter, onOpenPerya, onGameTap, onOpenGame }: Props) {
  const { t } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const activeCat = CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0]
  const isRebate = cat === 'highrebate'

  const [tier, setTier] = useState<RebateTier>('all')
  const [providers, setProviders] = useState<string[]>([])
  const [providersExpanded, setProvidersExpanded] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [games, setGames] = useState<SlotGame[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const sentinelRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [barH, setBarH] = useState(0)
  const lastYRef = useRef(0)
  const activeCatRef = useRef<HTMLButtonElement>(null)
  const activeProviderRef = useRef<HTMLButtonElement>(null)
  // 请求序号：弱网下旧响应晚到会覆盖新结果，只认最后一次请求
  const reqSeq = useRef(0)
  const providerSeq = useRef(0)

  async function loadGames(reset: boolean) {
    const nextPage = reset ? 1 : page + 1
    const seq = ++reqSeq.current
    if (reset) { setLoading(true); setGames([]) } else setLoadingMore(true)
    setError('')
    try {
      const res = await fetchGames({
        page: nextPage,
        limit: 30,
        siteCategory: isRebate ? undefined : activeCat.siteCategory,
        cashbackTier: isRebate ? tier : undefined,
        provider: !isRebate && provider !== 'all' ? provider : undefined,
        sortBy: 'weight',
        currency: activeCurrency,
      })
      if (seq !== reqSeq.current) return
      setGames((prev) => reset ? res.items : [...prev, ...res.items])
      setTotal(res.total)
      setPages(res.pages)
      setPage(nextPage)
    } catch (e) {
      if (seq !== reqSeq.current) return
      setError(e instanceof ApiError ? e.message : 'Failed to load games')
    } finally {
      if (seq === reqSeq.current) { setLoading(false); setLoadingMore(false) }
    }
  }

  useEffect(() => {
    const seq = ++providerSeq.current
    setProvidersExpanded(false)
    fetchProviders(undefined, activeCat.siteCategory)
      .then((list) => { if (seq === providerSeq.current) setProviders(list) })
      .catch(() => { if (seq === providerSeq.current) setProviders([]) })
  }, [activeCat.siteCategory])

  useEffect(() => {
    void loadGames(true)
  }, [cat, provider, tier, activeCurrency])

  // 菜单栏随滚动方向显隐：上滑(向下滚)收起、下滑(向上滚)出现；接近顶部时常驻显示
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      if (y < 12) setHidden(false)
      else if (y > lastYRef.current + 4) setHidden(true)
      else if (y < lastYRef.current - 4) setHidden(false)
      lastYRef.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 筛选栏改 fixed 后脱离文档流，用占位 div 撑出其实时高度（二级展开/收起、厂商异步加载都会变高）
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    setBarH(el.offsetHeight)
    const ro = new ResizeObserver(() => setBarH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 深链（如首页 chip / View All）时把选中的分类 tab、厂商 chip 滚进视野
  useEffect(() => {
    activeCatRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [cat])

  useEffect(() => {
    activeProviderRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [provider, providers])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading && !loadingMore && page < pages) void loadGames(false)
    }, { threshold: 0.1, rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading, loadingMore, page, pages, cat, provider, tier])

  function selectCat(id: string) {
    if (id === cat) return
    onChangeFilter({ cat: id, provider: 'all' })
  }

  function selectProvider(p: string) {
    if (p === provider) return
    onChangeFilter({ cat, provider: p })
  }

  async function onPlay(uuid: string) {
    if (!isLoggedIn) { onGameTap(); return }
    try {
      const { url } = await launchGame(uuid, 'mobile', activeCurrency)
      analytics.gameLaunch('real', uuid, activeCurrency, 'games')
      onOpenGame(url)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to launch game')
    }
  }

  // All 分类默认不给二级厂商菜单（全量厂商近百个噪音大，对齐 casinoplus：仅具体分类有二级）；
  // 但深链带了厂商筛选（如首页厂商专区 View All）时必须显示，否则用户看不到也清不掉筛选
  const showProviders = !isRebate && providers.length >= 2 && (cat !== 'all' || provider !== 'all')

  return (
    <div className="page-main">
      {/* 抽屉外壳：fixed 定位在 app 头正下方，overflow-hidden 把菜单裁在 app 头底边——收起时菜单缩进壳里，
          上边缘之外(顶部菜单区)绝不溢出。壳 pointer-events-none、本体 auto，收起后不挡下面游戏点击。
          fixed 逃出 .page-main 的 overflow-x:clip、独立合成层不抖；居中在 430px 壳内，高度随本体实时高度 */}
      <div
        className={`fixed left-1/2 z-20 w-full max-w-[430px] -translate-x-1/2 overflow-hidden ${hidden ? 'pointer-events-none' : ''}`}
        style={{ top: 'var(--app-header-height, 0px)', height: barH }}
      >
        {/* 菜单本体：向下滚 translateY 上滑收进抽屉(被壳裁掉)、向上滚滑出；transform 过渡=GPU 合成不抖 */}
        <div
          ref={barRef}
          className="bg-background border-b border-white/5 pointer-events-auto transition-transform duration-300 ease-out"
          style={{ transform: hidden ? `translateY(-${barH}px)` : 'translateY(0)' }}
        >
        {/* 一级分类：自然文字，选中=品牌色加粗+下划线 */}
        <div className="flex gap-6 px-4 pt-5 overflow-x-auto hide-scrollbar snap-x">
          {CATEGORIES.map((c) => {
            const active = c.id === cat
            return (
              <button
                key={c.id}
                ref={active ? activeCatRef : undefined}
                type="button"
                onClick={() => selectCat(c.id)}
                className={`relative flex-shrink-0 snap-start whitespace-nowrap pb-2.5 text-[18px] transition-colors active:scale-95 ${
                  active ? 'font-black text-primary' : 'font-semibold text-foreground/50'
                }`}
              >
                {t(c.labelKey)}
                <span className={`absolute bottom-0 left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full bg-primary transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
              </button>
            )
          })}
        </div>

        {/* 高洗码二级档位子菜单：2% / 1.5% / 1% */}
        {isRebate && (
          <div className="flex items-center gap-2 px-4 py-2.5">
            {TIER_TABS.map((tt) => (
              <button
                key={tt.id}
                type="button"
                onClick={() => setTier(tt.id)}
                className={`flex-shrink-0 px-3.5 py-1 rounded-full text-xs font-bold transition-colors active:scale-95 ${
                  tier === tt.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'
                }`}
              >
                {tt.labelKey ? t(tt.labelKey) : tt.label}
              </button>
            ))}
          </div>
        )}

        {/* 二级厂商菜单：单行横滑，⌄ 展开成多行面板（随整条菜单栏一起显隐，不再单独收起） */}
        {showProviders && (
          <div className="flex items-start gap-2 px-4 py-2.5">
            <div className={`flex gap-2 flex-1 min-w-0 ${providersExpanded ? 'flex-wrap' : 'overflow-x-auto hide-scrollbar'}`}>
              <button
                type="button"
                onClick={() => selectProvider('all')}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-colors active:scale-95 ${
                  provider === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'
                }`}
              >
                {t('slots.allProviders')}
              </button>
              {providers.map((p) => (
                <button
                  key={p}
                  ref={provider === p ? activeProviderRef : undefined}
                  type="button"
                  onClick={() => selectProvider(p)}
                  className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-colors active:scale-95 ${
                    provider === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-90 transition-transform"
              onClick={() => setProvidersExpanded(!providersExpanded)}
              aria-label={providersExpanded ? 'Collapse providers' : 'Expand providers'}
            >
              {providersExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        )}
        </div>
      </div>
      {/* 占位：撑出抽屉菜单的实时高度，让下方内容顺着往下排 */}
      <div aria-hidden style={{ height: barH }} />

      {/* Perya 嘉年华入口横幅（仅 perya 分类） */}
      {cat === 'perya' && (
        <div className="px-4 mt-3">
          <button
            type="button"
            className="w-full flex items-center justify-between rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform"
            style={{ background: 'linear-gradient(120deg, #2d1800 0%, #1a0d40 100%)', border: '1px solid rgba(255, 184, 0, 0.35)' }}
            onClick={onOpenPerya}
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">🎪</span>
              <div className="text-left">
                <p className="text-sm font-black text-white font-display">{t('games.peryaCarnival')}</p>
                <p className="text-[11px] text-white/60">{t('games.peryaCarnivalSub')}</p>
              </div>
            </div>
            <span className="flex-shrink-0 bg-primary text-primary-foreground font-black text-xs px-3 py-1.5 rounded-full">{t('games.enter')}</span>
          </button>
        </div>
      )}

      {/* 数量提示 */}
      {!loading && total > 0 && (
        <p className="px-4 mt-3 text-[11px] text-muted-foreground">{total.toLocaleString()} games</p>
      )}

      {/* 游戏 3 列 grid + 无限滚动 */}
      <div className="px-3 mt-2 grid grid-cols-3 gap-x-2 gap-y-3">
        {loading
          ? Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl animate-pulse bg-secondary" />
            ))
          : games.map((g) => (
              <GameCardV2 key={g.uuid} game={g} onTap={() => void onPlay(g.uuid)} size="lg" />
            ))
        }
        {loadingMore && Array.from({ length: 3 }).map((_, i) => (
          <div key={`more-${i}`} className="aspect-square rounded-xl animate-pulse bg-secondary" />
        ))}
      </div>

      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <p className="text-sm">{error}</p>
          <button type="button" className="flex items-center gap-1.5 text-xs text-primary" onClick={() => void loadGames(true)}>
            <RefreshCw size={13} />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && games.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">{t('slots.noGames')}</p>
      )}

      <div ref={sentinelRef} className="h-4" />

      {!loading && !loadingMore && games.length > 0 && page >= pages && (
        <p className="text-center text-[11px] text-muted-foreground py-4">{t('common.noMore')}</p>
      )}
    </div>
  )
}
