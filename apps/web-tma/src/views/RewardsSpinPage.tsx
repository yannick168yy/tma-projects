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
    const colors = ['#fde68a', '#fca5a5', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#fed7aa', '#f9a8d4', '#a7f3d0']
    const step = 100 / prizes.length
    return `conic-gradient(${prizes.map((_, i) => `${colors[i % colors.length]} ${i * step}% ${(i + 1) * step}%`).join(',')})`
  }, [prizes])

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
    <div className="min-h-screen bg-[#14151f] text-white">
      <section className="relative overflow-hidden px-4 pb-6 pt-[calc(var(--app-safe-top)+62px)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(250,204,21,.22),transparent_32%),radial-gradient(circle_at_86%_18%,rgba(59,130,246,.22),transparent_28%),linear-gradient(180deg,#242449_0%,#14151f_72%)]" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-amber-200/80">{t('spin.kicker')}</p>
              <h1 className="mt-1 font-display text-3xl font-black leading-none text-white">{t('spin.title')}</h1>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-300 text-amber-950 shadow-lg shadow-amber-500/30">
              <Gift size={24} />
            </div>
          </div>
          <p className="mt-3 max-w-[270px] text-xs font-semibold leading-relaxed text-white/62">{t('spin.subtitle')}</p>
        </div>
      </section>

      <main className="relative -mt-2 px-4 pb-8">
        {loading ? (
          <div className="flex h-80 items-center justify-center text-white/50">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[.06] px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/45">{t('spin.remaining')}</p>
                <p className="mt-1 text-2xl font-black text-amber-300">{status?.remainingChances ?? 0}</p>
              </div>
              <button type="button" className="rounded-xl border border-amber-300/25 bg-amber-300 px-3 py-3 text-left text-amber-950 active:scale-95 transition-transform" onClick={onOpenWallet}>
                <Wallet size={18} />
                <p className="mt-1 text-sm font-black">{t('spin.depositNow')}</p>
              </button>
            </div>

            <div className="relative mx-auto mb-5 flex aspect-square max-w-[360px] items-center justify-center">
              <div className="absolute -top-1 left-1/2 z-10 h-0 w-0 -translate-x-1/2 border-l-[16px] border-r-[16px] border-t-[30px] border-l-transparent border-r-transparent border-t-red-500 drop-shadow-lg" />
              <div
                className="relative h-[88%] w-[88%] rounded-full border-[10px] border-white/15 shadow-2xl transition-transform duration-[2600ms] ease-out"
                style={{ background: wheelBg, transform: `rotate(${rotation}deg)` }}
              >
                {prizes.map((prize, i) => {
                  const deg = (360 / prizes.length) * i + 360 / prizes.length / 2
                  return (
                    <div
                      key={prize.id ?? i}
                      className="absolute left-1/2 top-1/2 h-1/2 origin-top text-center"
                      style={{ transform: `rotate(${deg}deg) translateX(-50%)` }}
                    >
                      <span className="mt-4 block w-16 -translate-x-1/2 rounded-full bg-white/80 px-1 py-0.5 text-[10px] font-black text-slate-900 shadow-sm">
                        {prize.name}
                      </span>
                    </div>
                  )
                })}
                <button
                  type="button"
                  disabled={spinning || !status?.enabled || (status?.remainingChances ?? 0) <= 0}
                  className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-4 border-white bg-red-500 text-white shadow-xl active:scale-95 disabled:opacity-70"
                  onClick={() => void onSpin()}
                >
                  {spinning ? <Loader2 size={24} className="animate-spin" /> : <Sparkles size={22} />}
                  <span className="mt-1 text-sm font-black leading-none">{t('spin.spinBtn')}</span>
                </button>
              </div>
            </div>

            {result && (
              <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-300/12 px-4 py-3 text-center">
                <p className="text-xs font-bold text-amber-100/70">{t('spin.youWon')}</p>
                <p className="mt-1 text-2xl font-black text-amber-300">{fmtPhp(result.amountPhp)}</p>
              </div>
            )}
            {message && <p className="mb-4 text-center text-xs font-bold text-rose-300">{message}</p>}

            <section className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <Wallet size={15} className="text-amber-300" />
                <h2 className="text-sm font-black">{t('spin.howToGet')}</h2>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(status?.depositRules ?? []).filter((r) => r.enabled).map((rule) => (
                  <button key={rule.id ?? rule.minDepositPhp} type="button" className="rounded-xl border border-white/10 bg-white/[.06] px-2 py-3 text-center active:scale-95 transition-transform" onClick={onOpenWallet}>
                    <p className="text-xs font-black text-white">{fmtPhp(rule.minDepositPhp)}</p>
                    <p className="mt-1 text-[10px] font-bold text-amber-300">{rule.chances} {t('spin.chances')}</p>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Trophy size={15} className="text-amber-300" />
                <h2 className="text-sm font-black">{t('spin.recentWins')}</h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/8 bg-white/[.05]">
                {(status?.recentRecords ?? []).slice(0, 8).map((rec) => (
                  <div key={rec.id} className="flex items-center justify-between border-b border-white/6 px-3 py-2.5 last:border-0">
                    <span className="text-xs font-bold text-white/72">{rec.displayName}</span>
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
