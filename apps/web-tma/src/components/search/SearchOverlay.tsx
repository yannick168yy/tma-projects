import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronDown, ChevronUp, Search, X, RefreshCw } from 'lucide-react'
import { fetchGames, fetchThemes, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { localizedThemeLabel, themeColors } from '@/utils/theme-tag'
import SlotGameCard from '@/components/home/SlotGameCard'

interface Props {
  onClose: () => void
  onGameTap: () => void
  onOpenGame: (url: string) => void
}

export default function SearchOverlay({ onClose, onGameTap, onOpenGame }: Props) {
  const { t } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [themes, setThemes] = useState<string[]>([])
  const [selectedTheme, setSelectedTheme] = useState('all')
  const selectedThemeRef = useRef('all')
  const [games, setGames] = useState<SlotGame[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [themesExpanded, setThemesExpanded] = useState(false)
  const [launchingUuid, setLaunchingUuid] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasMore = page < pages

  const pageRef = useRef(1)

  async function doSearch(q: string, theme: string, reset = true) {
    const pageToFetch = reset ? 1 : pageRef.current + 1
    if (reset) {
      setLoading(true)
      pageRef.current = 1
      setPage(1)
      setGames([])
    } else {
      setLoadingMore(true)
    }
    setError('')
    try {
      const res = await fetchGames({
        search: q || undefined,
        themes: theme !== 'all' ? [theme] : undefined,
        limit: 30,
        page: pageToFetch,
      })
      if (reset) setGames(res.items)
      else setGames((prev) => [...prev, ...res.items])
      setTotal(res.total)
      setPages(res.pages)
      pageRef.current = pageToFetch
      setPage(pageToFetch)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Search failed')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const skipQueryWatch = useRef(true)

  useEffect(() => {
    void doSearch('', 'all')
    void fetchThemes().then(setThemes)
    const id = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (skipQueryWatch.current) {
      skipQueryWatch.current = false
      return
    }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(
      () => void doSearch(query.trim(), selectedThemeRef.current, true),
      300,
    )
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [query])

  function selectTheme(theme: string) {
    selectedThemeRef.current = theme
    setSelectedTheme(theme)
    void doSearch(query.trim(), theme, true)
  }

  function loadMore() {
    if (loadingMore || pageRef.current >= pages) return
    void doSearch(query.trim(), selectedThemeRef.current, false)
  }

  async function onPlay(uuid: string) {
    if (!isLoggedIn) {
      onGameTap()
      return
    }
    setLaunchingUuid(uuid)
    try {
      const { url } = await launchGame(uuid, 'mobile', activeCurrency)
      onOpenGame(url)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to launch game')
    } finally {
      setLaunchingUuid(null)
    }
  }

  function renderThemeChip(th: string) {
    const colors = themeColors(th)
    const active = selectedTheme === th
    return (
      <button
        key={th}
        type="button"
        onClick={() => selectTheme(th)}
        className={`flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-colors ${
          active ? 'text-primary-foreground' : 'text-foreground/70'
        }`}
        style={
          active
            ? { background: colors?.bg ?? 'var(--primary)', color: colors?.fg ?? 'var(--primary-foreground)' }
            : { background: colors ? `${colors.bg}33` : 'var(--secondary)' }
        }
      >
        {localizedThemeLabel(th, t)}
      </button>
    )
  }

  async function onDemo(uuid: string) {
    setLaunchingUuid(uuid)
    try {
      const { url } = await launchDemo(uuid, 'mobile', activeCurrency)
      onOpenGame(url)
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to launch demo')
    } finally {
      setLaunchingUuid(null)
    }
  }

  return (
    <div className="min-h-full bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button type="button" className="flex-shrink-0 text-muted-foreground" onClick={onClose}>
          <ChevronLeft size={22} />
        </button>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            type="text"
            placeholder={t('search.placeholder')}
            className="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              onClick={() => setQuery('')}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {themes.length > 0 && (
        <div className="flex items-start gap-1.5 px-4 pt-3 pb-1">
          <div
            className={`min-w-0 flex-1 ${
              themesExpanded ? 'max-h-36 overflow-y-auto overscroll-contain' : 'overflow-x-auto hide-scrollbar'
            }`}
          >
            <div className={`flex gap-2 ${themesExpanded ? 'flex-wrap' : 'flex-nowrap w-max min-w-full'}`}>
              <button
                type="button"
                onClick={() => selectTheme('all')}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-colors ${selectedTheme === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/70'}`}
              >
                {t('search.allThemes')}
              </button>
              {themes.map(renderThemeChip)}
            </div>
          </div>
          <button
            type="button"
            aria-expanded={themesExpanded}
            aria-label={themesExpanded ? t('search.collapseThemes') : t('search.expandThemes')}
            onClick={() => setThemesExpanded((v) => !v)}
            className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-secondary border border-border text-muted-foreground active:scale-95 transition-transform"
          >
            {themesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      )}

      <div className="px-4 py-2 flex items-center gap-2">
        <p className="text-muted-foreground text-[11px] font-bold flex-1">
          {query.trim() ? t('search.resultsCount', { count: total }) : t('search.allCount', { count: total })}
        </p>
        {loading && <RefreshCw size={12} className="text-muted-foreground animate-spin" />}
      </div>

      <div className="px-4 pb-6">
        {games.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              {games.map((game) => (
                <SlotGameCard
                  key={game.uuid}
                  game={game}
                  launching={launchingUuid === game.uuid}
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
        ) : (
          !loading && (
            <div className="text-center py-16">
              {error ? (
                <p className="text-sm text-red-400">{error}</p>
              ) : (
                <>
                  <p className="text-4xl mb-3">🔍</p>
                  <p className="text-foreground font-bold text-sm">
                    {query.trim() ? t('search.noResultsFor', { query }) : t('search.noResults')}
                  </p>
                  {query.trim() && <p className="text-muted-foreground text-xs mt-1">{t('search.tryAnother')}</p>}
                </>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}
