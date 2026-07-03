import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Search, RefreshCw } from 'lucide-react'
import SlotGameCard from '@/components/home/SlotGameCard'
import { fetchGames, fetchProviders, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { shortProviderName } from '@/utils/providers'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { analytics } from '@/utils/analytics'

interface Props {
  sortCategory?: string
  sortBy?: 'weight' | 'ph_bonus' | 'name'
  title?: string
  themes?: string[]
  gameStyles?: string[]
  playerTypes?: string[]
  onClose: () => void
  onGameTap: () => void
  onOpenGame: (url: string) => void
}

export default function SlotsLobby({
  sortCategory,
  sortBy,
  title,
  themes,
  gameStyles,
  playerTypes,
  onClose,
  onGameTap,
  onOpenGame,
}: Props) {
  const { t } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const [games, setGames] = useState<SlotGame[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('all')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function loadProviders() {
    try {
      setProviders(await fetchProviders())
    } catch {
      // ignore
    }
  }

  async function loadGames(reset = true, providerOverride?: string) {
    const provider = providerOverride ?? selectedProvider
    const page = reset ? 1 : currentPage + 1
    if (reset) {
      setLoading(true)
      setCurrentPage(1)
      setGames([])
    } else {
      setLoadingMore(true)
    }
    setError('')
    try {
      const res = await fetchGames({
        page,
        limit: 30,
        search: search || undefined,
        provider: provider !== 'all' ? provider : undefined,
        sortCategory,
        sortBy,
        themes,
        gameStyles,
        playerTypes,
        currency: activeCurrency,
      })
      if (reset) setGames(res.items)
      else setGames((prev) => [...prev, ...res.items])
      setTotal(res.total)
      setPages(res.pages)
      setCurrentPage(page)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load games')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  function onSearchInput() {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void loadGames(true), 350)
  }

  function selectProvider(p: string) {
    setSelectedProvider(p)
    void loadGames(true, p)
  }

  function loadMore() {
    if (loadingMore || currentPage >= pages) return
    void loadGames(false)
  }

  useEffect(() => {
    void loadProviders()
    void loadGames(true)
  }, [activeCurrency])

  async function onPlay(uuid: string) {
    if (!isLoggedIn) {
      onGameTap()
      return
    }
    setLaunchingUuid(uuid)
    try {
      const { url } = await launchGame(uuid, 'mobile', activeCurrency)
      analytics.gameLaunch('real', uuid, activeCurrency, 'slots_lobby')
      onOpenGame(url)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to launch game')
    } finally {
      setLaunchingUuid(null)
    }
  }

  async function onDemo(uuid: string) {
    setLaunchingUuid(uuid)
    try {
      const { url } = await launchDemo(uuid, 'mobile', activeCurrency)
      analytics.gameLaunch('demo', uuid, activeCurrency, 'slots_lobby')
      onOpenGame(url)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to launch demo')
    } finally {
      setLaunchingUuid(null)
    }
  }

  const hasMore = currentPage < pages

  return (
    <div className="page-main bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button type="button" className="flex-shrink-0 text-muted-foreground" onClick={onClose}>
          <ChevronLeft size={22} />
        </button>
        <h2 className="flex-1 text-sm font-bold text-foreground">
          {title || 'SLOTS'}
          {total > 0 && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {total.toLocaleString()} games
            </span>
          )}
        </h2>
      </div>

      <div className="flex-shrink-0 space-y-2 border-b border-border px-4 py-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            type="search"
            placeholder={t('slots.searchPlaceholder')}
            className="w-full rounded-xl bg-secondary py-2.5 pl-8 pr-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-primary"
            onChange={(e) => {
              setSearch(e.target.value)
              onSearchInput()
            }}
          />
        </div>

        {providers.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 hide-scrollbar">
            <button
              type="button"
              className={`flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-colors ${selectedProvider === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
              onClick={() => selectProvider('all')}
            >
              {t('slots.allProviders')}
            </button>
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                className={`flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-colors ${selectedProvider === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
                onClick={() => selectProvider(p)}
              >
                {shortProviderName(p)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-3">
        {loading && (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-secondary" />
            ))}
          </div>
        )}

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

        {!loading && !error && games.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {games.map((g) => (
                <SlotGameCard
                  key={g.uuid}
                  game={g}
                  launching={launchingUuid === g.uuid}
                  onPlay={onPlay}
                  onDemo={onDemo}
                />
              ))}
            </div>
            {hasMore && (
              <div className="mt-4 flex justify-center pb-2">
                <button
                  type="button"
                  className={`rounded-full bg-secondary px-6 py-2.5 text-sm font-bold text-foreground transition-opacity ${loadingMore ? 'opacity-50' : ''}`}
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? '…' : t('common.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
