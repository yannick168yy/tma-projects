import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gift, Loader2, Wallet, Trophy, Sparkles } from 'lucide-react'
import { ApiError } from '@/api/client'
import { drawSpin, fetchSpinStatus, type SpinStatus, type SpinDrawResult } from '@/api/spin'
import { useWalletStore } from '@/stores/wallet'

interface Props {
  onOpenWallet: () => void
}

function fmtPhp(amount: number): string {
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function RewardsSpinPage({ onOpenWallet }: Props) {
  const { t } = useTranslation()
  const wallet = useWalletStore()
  const [status, setStatus] = useState<SpinStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<SpinDrawResult | null>(null)

  const prizes = useMemo(() => status?.prizes.filter((p) => p.enabled) ?? [], [status])
  const wheelBg = useMemo(() => {
    if (!prizes.length) return '#2b2340'
    const colors = ['#fbbf24', '#064e3b', '#10b981', '#78350f', '#047857', '#f59e0b', '#065f46', '#d97706']
    const step = 100 / prizes.length
    return `conic-gradient(${prizes.map((_, i) => `${colors[i % colors.length]} ${i * step}% ${(i + 1) * step}%`).join(',')})`
  }, [prizes])
  const visiblePrizes = useMemo(() => prizes.slice(0, 8), [prizes])

  async function load() {
    setLoading(true)
    try {
      setStatus(await fetchSpinStatus())
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('spin.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function onSpin() {
    if (spinning || !status?.enabled || status.remainingChances <= 0 || prizes.length === 0) return
    setSpinning(true)
    setResult(null)
    setMessage('')
    try {
      const res = await drawSpin()
      const idx = Math.max(0, prizes.findIndex((p) => p.id === res.prizeId))
      const segment = 360 / Math.max(1, prizes.length)
      const target = 360 - (idx * segment + segment / 2)
      setRotation((prev) => prev + 1440 + target)
      window.setTimeout(async () => {
        setResult(res)
        setStatus((prev) => prev ? { ...prev, remainingChances: res.remainingChances } : prev)
        await wallet.refresh()
        await load()
        setSpinning(false)
      }, 2600)
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('spin.spinFailed'))
      setSpinning(false)
    }
  }

  return (
    <div className="page-main min-h-screen bg-[#080b14] pb-6 text-white">
      <section
        className="relative overflow-hidden px-4 pb-5 pt-[calc(var(--app-safe-top)+58px)]"
        style={{ background: 'linear-gradient(160deg, #14532d 0%, #0a2e1a 44%, #080b14 78%)' }}
      >
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-200/90">{t('spin.kicker')}</p>
              <h1 className="mt-1 bg-gradient-to-r from-white via-emerald-100 to-amber-300 bg-clip-text font-display text-[1.8rem] font-black leading-tight text-transparent drop-shadow-sm">
                {t('spin.title')}
              </h1>
            </div>
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 text-emerald-950 shadow-md shadow-amber-500/25">
              <Gift size={24} />
            </div>
          </div>
          <p className="mt-2 max-w-[290px] text-xs font-semibold leading-relaxed text-emerald-100/65">{t('spin.subtitle')}</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-950/40 px-2.5 py-2.5 text-center backdrop-blur-sm">
              <p className="text-amber-300 font-black text-xl leading-none">{status?.remainingChances ?? 0}</p>
              <p className="mt-1 text-[9px] leading-tight text-emerald-200/55">{t('spin.remaining')}</p>
            </div>
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-950/40 px-2.5 py-2.5 text-center backdrop-blur-sm">
              <p className="text-amber-300 font-black text-xl leading-none">{visiblePrizes.length || '-'}</p>
              <p className="mt-1 text-[9px] leading-tight text-emerald-200/55">{t('spin.prizes')}</p>
            </div>
            <button type="button" className="rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-2.5 py-2.5 text-center text-emerald-950 shadow-md shadow-amber-500/25 active:opacity-80" onClick={onOpenWallet}>
              <Wallet size={18} className="mx-auto" />
              <p className="mt-1 text-[10px] font-black leading-tight">{t('spin.depositNow')}</p>
            </button>
          </div>
        </div>
      </section>

      <main className="relative px-4 pb-8">
        {loading ? (
          <div className="flex h-80 items-center justify-center text-white/50">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="relative mx-auto mt-4 mb-5 flex aspect-square w-full max-w-[354px] items-center justify-center overflow-hidden rounded-[28px] border border-emerald-700/30 bg-emerald-950/35 px-4">
              <div className="absolute left-1/2 top-4 z-20 h-0 w-0 -translate-x-1/2 border-l-[15px] border-r-[15px] border-t-[28px] border-l-transparent border-r-transparent border-t-amber-300 drop-shadow-lg" />
              <div className="absolute inset-4 rounded-full border border-amber-300/25" />
              <div
                className="relative h-[78%] w-[78%] rounded-full border-[10px] border-emerald-950 shadow-2xl transition-transform duration-[2600ms] ease-out"
                style={{ background: wheelBg, transform: `rotate(${rotation}deg)` }}
              />
              <div className="pointer-events-none absolute inset-0">
                {visiblePrizes.map((prize, i) => {
                  const rad = ((360 / visiblePrizes.length) * i - 90) * Math.PI / 180
                  const left = 50 + Math.cos(rad) * 34
                  const top = 50 + Math.sin(rad) * 34
                  return (
                    <span
                      key={prize.id ?? i}
                      className="absolute flex h-9 min-w-[58px] items-center justify-center rounded-full border border-amber-200/60 bg-emerald-950/90 px-2 text-[10px] font-black text-amber-200 shadow-md"
                      style={{ left: `${left}%`, top: `${top}%`, transform: 'translate(-50%, -50%)' }}
                    >
                      {prize.name}
                    </span>
                  )
                })}
              </div>
              <button
                type="button"
                disabled={spinning || !status?.enabled || (status?.remainingChances ?? 0) <= 0}
                className="absolute left-1/2 top-1/2 z-10 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-4 border-amber-100 bg-gradient-to-br from-amber-400 to-yellow-500 text-emerald-950 shadow-xl shadow-amber-500/25 active:scale-95 disabled:opacity-60"
                onClick={() => void onSpin()}
              >
                {spinning ? <Loader2 size={24} className="animate-spin" /> : <Sparkles size={22} />}
                <span className="mt-1 text-sm font-black leading-none">{t('spin.spinBtn')}</span>
              </button>
            </div>

            {result && (
              <div className="mx-0 mb-4 overflow-hidden rounded-2xl border border-emerald-600/30">
                <div className="bg-gradient-to-r from-emerald-700 via-emerald-800 to-amber-500 px-5 py-4 text-center">
                  <p className="text-xs font-bold text-amber-100/75">{t('spin.youWon')}</p>
                  <p className="mt-1 font-display text-2xl font-black text-white drop-shadow">{fmtPhp(result.amountPhp)}</p>
                </div>
              </div>
            )}
            {message && <p className="mb-4 text-center text-xs font-bold text-rose-300">{message}</p>}

            <section className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <Wallet size={15} className="text-amber-300" />
                <h2 className="text-sm font-black text-emerald-100">{t('spin.howToGet')}</h2>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(status?.depositRules ?? []).filter((r) => r.enabled).map((rule) => (
                  <button key={rule.id ?? rule.minDepositPhp} type="button" className="rounded-xl border border-emerald-700/30 bg-emerald-950/40 px-2 py-3 text-center active:scale-95 transition-transform" onClick={onOpenWallet}>
                    <p className="text-xs font-black text-white">{fmtPhp(rule.minDepositPhp)}</p>
                    <p className="mt-1 text-[10px] font-bold text-amber-300">{rule.chances} {t('spin.chances')}</p>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Trophy size={15} className="text-amber-300" />
                <h2 className="text-sm font-black text-emerald-100">{t('spin.recentWins')}</h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-emerald-700/30 bg-emerald-950/35">
                {(status?.recentRecords ?? []).slice(0, 8).map((rec) => (
                  <div key={rec.id} className="flex items-center justify-between border-b border-emerald-700/25 px-3 py-2.5 last:border-0">
                    <span className="text-xs font-bold text-emerald-100/72">{rec.displayName}</span>
                    <span className="text-xs font-black text-amber-300">{t('common.won')} {fmtPhp(rec.amountPhp)}</span>
                  </div>
                ))}
                {status?.recentRecords.length === 0 && (
                  <p className="px-3 py-5 text-center text-xs font-bold text-white/40">{t('spin.noRecords')}</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
