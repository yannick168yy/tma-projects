import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Search, X, RefreshCw } from 'lucide-react'
import { fetchGames, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import SlotGameCard from '@/components/home/SlotGameCard'

interface Props {
  onClose: () => void
  onGameTap: () => void
  onOpenGame: (url: string) => void
}

export default function SearchOverlay({ onClose, onGameTap, onOpenGame }: Props) {
  const { t } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [games, setGames] = useState<SlotGame[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasMore = page < pages

  useEffect(() => { inputRef.current?.focus() }, [])

  const doSearch = useCallback(async (q: string, reset = true) => {
    if (reset) { setLoading(true); setPage(1); setGames([]) }
    else setLoadingMore(true)
    setError('')
    try {
      const res = await fetchGames({ search: q || undefined, limit: 30, page: reset ? 1 : page })
      if (reset) setGames(res.items)
      else setGames((prev) => [...prev, ...res.items])
      setTotal(res.total); setPages(res.pages)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Search failed')
    } finally {
      setLoading(false); setLoadingMore(false)
    }
  }, [page])

  function onQueryChange(q: string) {
    setQuery(q)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!q.trim()) { setGames([]); setTotal(0); return }
    searchTimer.current = setTimeout(() => void doSearch(q.trim()), 350)
  }

  async function onPlay(uuid: string) {
    if (!isLoggedIn) { onGameTap(); return }
    setLaunchingUuid(uuid)
    try { const { url } = await launchGame(uuid); onOpenGame(url) }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Launch failed') }
    finally { setLaunchingUuid(null) }
  }

  async function onDemo(uuid: string) {
    setLaunchingUuid(uuid)
    try { const { url } = await launchDemo(uuid); onOpenGame(url) }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Demo failed') }
    finally { setLaunchingUuid(null) }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-shrink-0">
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground flex-shrink-0" onClick={onClose}>
          <ChevronLeft size={18} />
        </button>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t('search.placeholder')}
            className="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {query && (
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => onQueryChange('')}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {query && (
        <p className="px-4 py-1 text-xs text-muted-foreground flex-shrink-0">
          {loading ? t('search.searching') : `${total} ${t('search.results')}`}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading && (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-secondary" />)}
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <p className="text-sm">{error}</p>
            <button type="button" className="flex items-center gap-1.5 text-xs text-primary" onClick={() => void doSearch(query.trim())}>
              <RefreshCw size={13} /> {t('common.retry')}
            </button>
          </div>
        )}
        {!loading && !error && games.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {games.map((g) => (
                <SlotGameCard key={g.uuid} game={g} launching={launchingUuid === g.uuid} onPlay={onPlay} onDemo={onDemo} />
              ))}
            </div>
            {hasMore && (
              <button
                type="button"
                className="mt-4 w-full py-3 rounded-xl bg-secondary text-sm font-bold text-muted-foreground flex items-center justify-center gap-2"
                disabled={loadingMore}
                onClick={() => { setPage((p) => p + 1); void doSearch(query.trim(), false) }}
              >
                {loadingMore ? <RefreshCw size={14} className="animate-spin" /> : null}
                {t('common.loadMore')}
              </button>
            )}
          </>
        )}
        {!loading && !error && query && games.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <p className="text-sm">{t('search.noResults')}</p>
          </div>
        )}
        {!query && (
          <div className="py-12 text-center text-muted-foreground">
            <Search size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t('search.typeToSearch')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
