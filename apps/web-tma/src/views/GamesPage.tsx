import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import GameCardV2 from '@/components/home/GameCardV2'
import { fetchGames, fetchProviders, launchGame, type SlotGame } from '@/api/slots'
import { shortProviderName } from '@/utils/providers'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { analytics } from '@/utils/analytics'
import chipHotImg from '@/assets/chips/hot.webp'
import chipSlotsImg from '@/assets/chips/slots.png'
import chipLiveImg from '@/assets/chips/live.png'
import chipPokerImg from '@/assets/chips/poker.png'
import chipBingoImg from '@/assets/chips/bingo.png'
import chipSportsImg from '@/assets/chips/sports.png'
import chipFishingImg from '@/assets/chips/fishing.png'

interface CategoryDef { id: string; labelKey: string; siteCategory?: string; icon?: string; image?: string }

// 一级分类：All + site_category；perya 排第二（菲市场黄金铺位）
const CATEGORIES: CategoryDef[] = [
  { id: 'all',     image: chipHotImg,     labelKey: 'games.catAll'      },
  { id: 'perya',   icon: '🐓',            labelKey: 'home.chipPerya',   siteCategory: 'perya'   },
  { id: 'slot',    image: chipSlotsImg,   labelKey: 'home.chipSlots',   siteCategory: 'slot'    },
  { id: 'casino',  image: chipLiveImg,    labelKey: 'home.chipCasino',  siteCategory: 'casino'  },
  { id: 'fishing', image: chipFishingImg, labelKey: 'home.chipFishing', siteCategory: 'fishing' },
  { id: 'lottery', image: chipBingoImg,   labelKey: 'home.chipLottery', siteCategory: 'lottery' },
  { id: 'poker',   image: chipPokerImg,   labelKey: 'home.chipPoker',   siteCategory: 'poker'   },
  { id: 'sports',  image: chipSportsImg,  labelKey: 'home.chipSports',  siteCategory: 'sports'  },
  { id: 'other',   icon: '🎮',            labelKey: 'home.chipOther',   siteCategory: 'other'   },
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

  const [providers, setProviders] = useState<string[]>([])
  const [providersExpanded, setProvidersExpanded] = useState(false)
  const [games, setGames] = useState<SlotGame[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const sentinelRef = useRef<HTMLDivElement>(null)
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
        siteCategory: activeCat.siteCategory,
        provider: provider !== 'all' ? provider : undefined,
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
  }, [cat, provider, activeCurrency])

  // 深链带厂商时（如首页厂商专区 View All），把选中 chip 滚进视野
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
  }, [loading, loadingMore, page, pages, cat, provider])

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
  const showProviders = providers.length >= 2 && (cat !== 'all' || provider !== 'all')

  return (
    <div className="page-main">
      {/* 一级分类 tab（sticky 吸顶） */}
      <div className="sticky z-20 bg-background border-b border-white/5" style={{ top: 'var(--app-header-height, 0px)' }}>
        <div className="flex gap-0.5 px-2 overflow-x-auto hide-scrollbar snap-x snap-mandatory">
          {CATEGORIES.map((c) => {
            const active = c.id === cat
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCat(c.id)}
                className="relative flex-shrink-0 snap-start flex flex-col items-center gap-0.5 px-2.5 pt-2 pb-0 min-w-[58px] active:scale-95 transition-transform"
              >
                {active && (
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 bottom-0 rounded-t-lg"
                    style={{ background: 'linear-gradient(180deg, rgba(220,38,38,0.28) 0%, rgba(220,38,38,0.06) 55%, transparent 100%)' }}
                  />
                )}
                {c.image ? (
                  <img
                    src={c.image}
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
                    {c.icon}
                  </span>
                )}
                <span className={`relative text-[11px] font-semibold leading-tight pb-2.5 ${active ? 'text-red-400' : 'text-foreground/75'}`}>
                  {t(c.labelKey)}
                </span>
                <span className={`absolute bottom-0 left-1 right-1 h-[3px] rounded-full transition-opacity ${active ? 'bg-red-500 opacity-100' : 'opacity-0'}`} />
              </button>
            )
          })}
        </div>
      </div>

      {/* 二级厂商菜单：单行横滑，⌄ 展开成多行面板 */}
      {showProviders && (
        <div className="flex items-start gap-2 px-4 mt-3">
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
                {shortProviderName(p)}
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
