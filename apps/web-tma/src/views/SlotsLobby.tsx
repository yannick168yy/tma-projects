import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Search, RefreshCw } from 'lucide-react'
import SlotGameCard from '@/components/home/SlotGameCard'
import { fetchGames, fetchProviders, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

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

export default function SlotsLobby({ sortCategory, sortBy, title, themes, gameStyles, playerTypes, onClose, onGameTap, onOpenGame }: Props) {
  const { t } = useTranslation()
  const isLoggedIn = useAuthStore((s) => Boolean(s.token && s.user))
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

  async function loadProviders() {
    try { setProviders(await fetchProviders()) } catch { /* ignore */ }
  }

  async function loadGames(reset = true) {
    if (reset) { setLoading(true); setCurrentPage(1); setGames([]) }
    else setLoadingMore(true)
    setError('')
    try {
      const pg = reset ? 1 : currentPage
      const res = await fetchGames({ page: pg, limit: 30, search: search || undefined, provider: selectedProvider !== 'all' ? selectedProvider : undefined, sortCategory, sortBy, themes, gameStyles, playerTypes })
      if (reset) setGames(res.items)
      else setGames((prev) => [...prev, ...res.items])
      setTotal(res.total); setPages(res.pages)
      if (!reset) setCurrentPage(pg)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.loadFailed'))
    } finally {
      setLoading(false); setLoadingMore(false)
    }
  }

  useEffect(() => { void loadProviders(); void loadGames() }, [])
  useEffect(() => { const t = setTimeout(() => void loadGames(), 350); return () => clearTimeout(t) }, [search, selectedProvider])

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
      <div className="flex items-center gap-3 px-4 pt-3 pb-2 flex-shrink-0">
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary flex-shrink-0" onClick={onClose}>
          <ChevronLeft size={18} className="text-muted-foreground" />
        </button>
        <h2 className="flex-1 text-sm font-black text-foreground">{title || t('slots.allGames')}</h2>
        <span className="text-xs text-muted-foreground">{total} {t('common.games_count')}</span>
      </div>

      <div className="px-4 pb-2 flex-shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} placeholder={t('search.placeholder')} className="w-full bg-secondary border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary" onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {providers.length > 0 && (
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto hide-scrollbar flex-shrink-0">
          {['all', ...providers].map((p) => (
            <button key={p} type="button" className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${selectedProvider === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`} onClick={() => setSelectedProvider(p)}>
              {p === 'all' ? t('common.all') : p}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading && <div className="grid grid-cols-3 gap-3">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-secondary" />)}</div>}
        {!loading && error && (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <p className="text-sm">{error}</p>
            <button type="button" className="flex items-center gap-1.5 text-xs text-primary" onClick={() => void loadGames()}>
              <RefreshCw size={13} /> {t('common.retry')}
            </button>
          </div>
        )}
        {!loading && !error && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {games.map((g) => <SlotGameCard key={g.uuid} game={g} launching={launchingUuid === g.uuid} onPlay={onPlay} onDemo={onDemo} />)}
            </div>
            {currentPage < pages && (
              <button type="button" className="mt-4 w-full py-3 rounded-xl bg-secondary text-sm font-bold text-muted-foreground flex items-center justify-center gap-2" disabled={loadingMore} onClick={() => { setCurrentPage((p) => p + 1); void loadGames(false) }}>
                {loadingMore ? <RefreshCw size={14} className="animate-spin" /> : null}
                {t('common.loadMore')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
