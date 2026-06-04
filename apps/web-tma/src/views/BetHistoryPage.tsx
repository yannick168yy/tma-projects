import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Copy, CheckCircle2, X } from 'lucide-react'
import { fetchBets, type BetRound } from '@/api/bets'

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

function localGameName(item: BetRound, lang: string): string {
  if (lang === 'zh-CN' && item.gameNameZh) return item.gameNameZh
  if (lang === 'vi'   && item.gameNameVi) return item.gameNameVi
  if (lang === 'id'   && item.gameNameId) return item.gameNameId
  return item.gameName ?? '—'
}

function GameThumb({ item }: { item: BetRound }) {
  const src = item.gameImageHq ?? item.gameImage
  if (!src) {
    return (
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-2xl">🎰</div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className="h-12 w-12 flex-shrink-0 rounded-xl object-cover bg-secondary"
      loading="lazy"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
    />
  )
}

function CopyRoundId({ roundId }: { roundId: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard?.writeText(roundId).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1 transition-opacity hover:opacity-70"
      onClick={copy}
    >
      <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
        #{roundId.length > 12 ? roundId.slice(-12) : roundId}
      </span>
      {copied
        ? <CheckCircle2 size={10} className="text-emerald-400" />
        : <Copy size={10} className="text-muted-foreground/40" />}
    </button>
  )
}

const PAGE_SIZE = 20

export default function BetHistoryPage({ onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<BetRound[]>([])
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [loading])

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

  const lang = i18n.language

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-4">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          onClick={onClose}
        >
          <ChevronLeft size={18} />
        </button>
        <h2 className="font-display text-base font-black text-foreground">{t('betHistory.title')}</h2>
        {total > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">{total} {t('betHistory.records')}</span>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
            <span className="mb-3 text-4xl">🎰</span>
            <p className="font-display text-sm font-black text-foreground">{t('betHistory.empty')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('betHistory.emptyHint')}</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="divide-y divide-border">
            {items.map((item, idx) => {
              const net = item.winAmount - item.betAmount
              const netPositive = net > 0
              const netZero = Math.abs(net) < 0.001

              return (
                <div key={item.roundId ?? idx} className="flex items-center gap-3 px-4 py-3">
                  {/* 游戏图标 */}
                  <GameThumb item={item} />

                  {/* 游戏信息 */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground leading-tight">
                      {localGameName(item, lang)}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {item.gameProvider && (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {item.gameProvider}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{formatTime(item.createdAt)}</span>
                    </div>
                    {item.roundId && (
                      <div className="mt-1">
                        <CopyRoundId roundId={item.roundId} />
                      </div>
                    )}
                  </div>

                  {/* 金额 */}
                  <div className="flex-shrink-0 text-right">
                    {/* 净盈亏 */}
                    <p className={`text-sm font-black tabular-nums ${netZero ? 'text-muted-foreground' : netPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {netZero ? '±' : netPositive ? '+' : ''}{formatAmount(Math.abs(net), item.currencyCode)}
                    </p>
                    {/* 下注 / 赢取 小字 */}
                    <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {t('betHistory.bet')} {formatAmount(item.betAmount, item.currencyCode)}
                    </p>
                    {item.winAmount > 0 && (
                      <p className="text-[10px] text-emerald-400/70 tabular-nums">
                        {t('betHistory.win')} {formatAmount(item.winAmount, item.currencyCode)}
                      </p>
                    )}
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
