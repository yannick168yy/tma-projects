import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, CircleDollarSign, X } from 'lucide-react'
import { fetchLedger, type LedgerItem } from '@/api/ledger'

interface Props { onClose: () => void }

type Range = 'today' | '7d' | '30d'

const RANGES: Range[] = ['today', '7d', '30d']
const REWARD_TYPES = ['bonus', 'rebate']

function dateFrom(range: Range): string {
  const d = new Date()
  if (range === '7d') d.setDate(d.getDate() - 6)
  if (range === '30d') d.setDate(d.getDate() - 29)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatMoney(amount: number, currency: string): string {
  const sign = amount > 0 ? '+' : ''
  if (currency === 'PHP') return `${sign}₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `${sign}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${currency}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatShortDate(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-PH', { month: 'short', day: '2-digit' })
}

function displayDescription(item: LedgerItem): string {
  if (item.type === 'rebate') {
    const match = item.description.match(/^(\w+)\s+rebate\s+(.+)$/i)
    if (match) {
      const shortDate = formatShortDate(match[2])
      if (shortDate) return `${match[1]} rebate ${shortDate}`
    }
    return 'Cash Rebate'
  }
  return item.description || item.id
}

export default function LedgerRecordsPage({ onClose }: Props) {
  const { t } = useTranslation()
  const [range, setRange] = useState<Range>('today')
  const [items, setItems] = useState<LedgerItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loaderRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const hasMore = items.length < total

  const loadPage = useCallback(async (p: number, nextRange: Range) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError('')
    try {
      const res = await fetchLedger(p, dateFrom(nextRange), REWARD_TYPES)
      setTotal(res.total)
      setItems((prev) => p === 1 ? res.items : [...prev, ...res.items])
      setPage(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadPage(1, 'today') }, [])

  function switchRange(nextRange: Range) {
    if (nextRange === range || loading) return
    setRange(nextRange)
    setItems([])
    setTotal(0)
    setPage(1)
    void loadPage(1, nextRange)
  }

  useEffect(() => {
    if (!loaderRef.current || !hasMore) return
    const ob = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) void loadPage(page + 1, range) },
      { rootMargin: '120px' },
    )
    ob.observe(loaderRef.current)
    return () => ob.disconnect()
  }, [hasMore, page, range, loadPage])

  return (
    <div className="page-main pb-6">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          onClick={onClose}
        >
          <ChevronLeft size={18} />
        </button>
        <h2 className="font-display text-base font-black text-foreground">{t('menu.creditRecords')}</h2>
        {total > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">{total} {t('betHistory.records')}</span>
        )}
      </div>

      <div className="flex gap-1 border-b border-border px-4 py-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              range === r
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => switchRange(r)}
          >
            {t(`ledger.range.${r}`)}
          </button>
        ))}
      </div>

      <div>
        {items.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <CircleDollarSign size={42} className="mb-3 text-muted-foreground/35" />
            <p className="font-display text-sm font-black text-foreground">{t('common.noRecords')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('ledger.rewardsOnly')}</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="divide-y divide-border">
            {items.map((item) => {
              const positive = item.amount > 0
              return (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${positive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                    <CircleDollarSign size={19} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold leading-tight text-foreground">
                      {t(`ledger.types.${item.type}`, { defaultValue: item.type })}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{displayDescription(item)}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{formatTime(item.createdAt)}</p>
                  </div>

                  <div className="flex-shrink-0 text-right">
                    <p className={`text-sm font-black tabular-nums ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatMoney(item.amount, item.currency)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {t('ledger.balanceAfter')} {formatMoney(item.balanceAfter, item.currency).replace(/^\+/, '')}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-400">
            <X size={14} /><span>{error}</span>
          </div>
        )}

        <div ref={loaderRef} className="h-1" />
        <div className="h-8" />
      </div>
    </div>
  )
}
