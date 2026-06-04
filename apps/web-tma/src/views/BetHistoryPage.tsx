import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, TrendingDown, TrendingUp, RotateCcw, X } from 'lucide-react'
import { fetchBets, type BetRecord } from '@/api/bets'

interface Props { onClose: () => void }

function formatAmount(amount: number, currencyCode: string): string {
  if (currencyCode === 'PHP') {
    return '₱' + amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + ' ' + currencyCode
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function BetTypeIcon({ betType }: { betType: string }) {
  if (betType === 'win') return <TrendingUp size={14} className="text-emerald-400" />
  if (betType === 'refund' || betType === 'rollback') return <RotateCcw size={14} className="text-amber-400" />
  return <TrendingDown size={14} className="text-red-400" />
}

const PAGE_SIZE = 20

export default function BetHistoryPage({ onClose }: Props) {
  const { t } = useTranslation()
  const [items, setItems] = useState<BetRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loaderRef = useRef<HTMLDivElement>(null)
  const hasMore = items.length < total

  const loadPage = useCallback(async (p: number) => {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetchBets(p, PAGE_SIZE)
      setTotal(res.total)
      setItems((prev) => p === 1 ? res.items : [...prev, ...res.items])
      setPage(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [loading, t])

  useEffect(() => { void loadPage(1) }, [])

  useEffect(() => {
    if (!loaderRef.current || !hasMore) return
    const ob = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !loading) void loadPage(page + 1) },
      { rootMargin: '120px' },
    )
    ob.observe(loaderRef.current)
    return () => ob.disconnect()
  }, [hasMore, loading, page, loadPage])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-4">
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground" onClick={onClose}>
          <ChevronLeft size={18} />
        </button>
        <h2 className="font-display text-base font-black text-foreground">{t('betHistory.title')}</h2>
        {total > 0 && <span className="ml-auto text-xs text-muted-foreground">{total} {t('betHistory.records')}</span>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-24 text-center px-8">
            <span className="mb-3 text-4xl">🎰</span>
            <p className="font-display text-sm font-black text-foreground">{t('betHistory.empty')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('betHistory.emptyHint')}</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary">
                  <BetTypeIcon betType={item.betType} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-foreground">{t(`betHistory.type.${item.betType}`)}</span>
                    {item.providerId && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{item.providerId}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{formatTime(item.createdAt)}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className={`text-sm font-black tabular-nums ${item.betType === 'win' ? 'text-emerald-400' : item.betType === 'bet' ? 'text-red-400' : 'text-amber-400'}`}>
                    {item.betType === 'win' ? '+' : item.betType === 'bet' ? '-' : ''}{formatAmount(item.amount, item.currencyCode)}
                  </p>
                  {item.roundId && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground/50 tabular-nums">#{item.roundId.slice(-8)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-400">
            <X size={14} />
            <span>{error}</span>
          </div>
        )}

        <div ref={loaderRef} className="h-1" />
        <div className="h-8" />
      </div>
    </div>
  )
}
