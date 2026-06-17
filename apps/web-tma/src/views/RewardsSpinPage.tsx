import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gift, Loader2, Wallet, Trophy, ChevronRight, Sparkles, Coins } from 'lucide-react'
import { ApiError } from '@/api/client'
import { drawSpin, fetchSpinStatus, type SpinStatus, type SpinDrawResult } from '@/api/spin'
import { useWalletStore } from '@/stores/wallet'
import SpinWheel from '@/components/spin/SpinWheel'
import BuntingStrip from '@/components/bingo/BuntingStrip'

interface Props {
  onOpenWallet: () => void
}

const BUNTING = ['#a855f7', '#f59e0b', '#ec4899', '#f97316', '#7c3aed', '#fbbf24', '#db2777', '#c084fc'] as const

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
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null)

  const rules = useMemo(() => (status?.depositRules ?? []).filter((r) => r.enabled && r.id), [status])
  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) ?? rules[0] ?? null,
    [rules, selectedRuleId],
  )
  const prizes = useMemo(
    () => status?.prizes.filter((p) => p.enabled && p.ruleId === selectedRule?.id) ?? [],
    [selectedRule?.id, status],
  )
  const wheelPrizes = useMemo(() => prizes.slice(0, 8), [prizes])
  const canSpin = Boolean(
    selectedRule?.id
    && status?.enabled
    && (selectedRule.remainingChances ?? 0) > 0
    && wheelPrizes.length > 0,
  )

  async function load() {
    setLoading(true)
    try {
      const next = await fetchSpinStatus()
      setStatus(next)
      setSelectedRuleId((current) => {
        if (current && next.depositRules.some((rule) => rule.id === current)) return current
        const available = next.depositRules.find((rule) => rule.enabled && (rule.remainingChances ?? 0) > 0)
        return available?.id ?? next.depositRules.find((rule) => rule.enabled)?.id ?? null
      })
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('spin.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function onSpin() {
    if (!selectedRule?.id || spinning || !canSpin) return
    setSpinning(true)
    setResult(null)
    setMessage('')
    try {
      const res = await drawSpin(selectedRule.id)
      const idx = Math.max(0, wheelPrizes.findIndex((p) => p.id === res.prizeId))
      const segment = 360 / Math.max(1, wheelPrizes.length)
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
    <div className="page-main min-h-screen bg-[#080b14] pb-8 text-white">
      <section
        className="relative overflow-hidden px-4 pb-5 pt-[calc(var(--app-safe-top)+58px)]"
        style={{ background: 'linear-gradient(160deg, #5b21b6 0%, #3b0764 38%, #1a0533 68%, #080b14 92%)' }}
      >
        <div className="pointer-events-none absolute -right-8 top-6 h-28 w-28 rounded-full bg-fuchsia-500/25 blur-2xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-24 rounded-full bg-violet-500/20 blur-xl" />

        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-violet-200/90">{t('spin.kicker')}</p>
              <h1 className="mt-1 bg-gradient-to-r from-white via-violet-100 to-amber-300 bg-clip-text font-display text-[1.85rem] font-black leading-tight text-transparent drop-shadow-sm">
                {t('spin.title')}
              </h1>
              <p className="mt-2 max-w-[300px] text-xs font-semibold leading-relaxed text-violet-100/60">{t('spin.subtitle')}</p>
            </div>
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-lg shadow-fuchsia-500/35">
              <Gift size={28} strokeWidth={2.2} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className="rounded-2xl border border-violet-400/25 bg-purple-950/50 px-2 py-3 text-center backdrop-blur-sm">
              <p className="font-display text-2xl font-black leading-none text-amber-300">{selectedRule?.remainingChances ?? 0}</p>
              <p className="mt-1.5 text-[9px] font-bold leading-tight text-violet-200/55">{t('spin.remaining')}</p>
            </div>
            <div className="rounded-2xl border border-violet-400/25 bg-purple-950/50 px-2 py-3 text-center backdrop-blur-sm">
              <p className="font-display text-2xl font-black leading-none text-amber-300">{wheelPrizes.length || '—'}</p>
              <p className="mt-1.5 text-[9px] font-bold leading-tight text-violet-200/55">{t('spin.prizes')}</p>
            </div>
            <button
              type="button"
              className="rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 px-2 py-3 text-center text-purple-950 shadow-md shadow-amber-500/25 active:scale-[0.98] transition-transform"
              onClick={onOpenWallet}
            >
              <Wallet size={20} className="mx-auto" strokeWidth={2.2} />
              <p className="mt-1 text-[10px] font-black leading-tight">{t('spin.depositNow')}</p>
            </button>
          </div>
        </div>
      </section>

      <main className="relative px-4">
        {loading ? (
          <div className="flex h-96 items-center justify-center text-white/50">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : (
          <>
            {rules.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                {rules.map((rule) => {
                  const active = rule.id === selectedRule?.id
                  const max = rule.maxDepositPhp == null ? '+' : ` – ${fmtPhp(rule.maxDepositPhp)}`
                  return (
                    <button
                      key={rule.id}
                      type="button"
                      className={`min-w-[140px] flex-shrink-0 rounded-2xl border px-3.5 py-2.5 text-left transition-all active:scale-[0.98] ${
                        active
                          ? 'border-fuchsia-300/50 bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white shadow-md shadow-fuchsia-500/25'
                          : 'border-purple-700/35 bg-purple-950/55 text-violet-100'
                      }`}
                      onClick={() => { setSelectedRuleId(rule.id!); setResult(null); setMessage('') }}
                    >
                      <p className="truncate text-xs font-black">{rule.name}</p>
                      <p className={`mt-0.5 text-[10px] font-bold ${active ? 'text-violet-100/85' : 'text-amber-300/85'}`}>
                        {fmtPhp(rule.minDepositPhp)}{max}
                      </p>
                      <p className={`mt-1 text-[10px] font-black ${active ? 'text-white/90' : 'text-violet-300/65'}`}>
                        {rule.remainingChances ?? 0} {t('spin.chances')}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="relative mt-5 overflow-hidden rounded-3xl border border-purple-700/40 bg-gradient-to-b from-purple-950/70 to-[#080b14] px-3 pb-5 pt-2">
              <BuntingStrip colors={[...BUNTING]} />
              <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-violet-200/80">
                <Sparkles size={12} className="text-fuchsia-300" />
                <span>{t('spin.title')}</span>
                <Sparkles size={12} className="text-fuchsia-300" />
              </div>

              <div className="mt-3">
                {wheelPrizes.length > 0 ? (
                  <SpinWheel
                    prizes={wheelPrizes}
                    rotation={rotation}
                    spinning={spinning}
                    disabled={!canSpin}
                    spinLabel={t('spin.spinBtn')}
                    onSpin={() => void onSpin()}
                  />
                ) : (
                  <div className="flex h-64 items-center justify-center text-sm font-bold text-violet-200/40">
                    {t('spin.noRecords')}
                  </div>
                )}
              </div>

              {!canSpin && !spinning && wheelPrizes.length > 0 && (
                <p className="mt-2 text-center text-[11px] font-bold text-violet-200/50">
                  {(selectedRule?.remainingChances ?? 0) <= 0 ? t('spin.depositNow') : ''}
                </p>
              )}
            </div>

            {result && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-fuchsia-400/35 shadow-lg shadow-fuchsia-500/20">
                <div className="relative overflow-hidden bg-gradient-to-r from-violet-700 via-fuchsia-700 to-amber-500 px-5 py-5 text-center">
                  <div className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
                  <div className="pointer-events-none absolute -bottom-6 -left-4 h-24 w-24 rounded-full bg-amber-300/15" />
                  <p className="relative text-xs font-bold uppercase tracking-widest text-violet-100/85">{t('spin.youWon')}</p>
                  <p className="relative mt-1 font-display text-3xl font-black text-white drop-shadow-md">{fmtPhp(result.amountPhp)}</p>
                  <p className="relative mt-1 text-sm font-bold text-violet-50/90">{result.prizeName}</p>
                </div>
              </div>
            )}
            {message && <p className="mt-4 text-center text-xs font-bold text-rose-300">{message}</p>}

            <section className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-900/70">
                  <Coins size={14} className="text-fuchsia-300" />
                </div>
                <h2 className="text-sm font-black text-violet-100">{t('spin.howToGet')}</h2>
              </div>
              <div className="space-y-2">
                {rules.map((rule) => {
                  const active = rule.id === selectedRule?.id
                  const max = rule.maxDepositPhp == null ? '+' : ` – ${fmtPhp(rule.maxDepositPhp)}`
                  return (
                    <button
                      key={rule.id ?? rule.minDepositPhp}
                      type="button"
                      className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3.5 text-left transition-all active:scale-[0.98] ${
                        active
                          ? 'border-fuchsia-400/35 bg-gradient-to-r from-purple-900/80 to-purple-950/60'
                          : 'border-purple-700/30 bg-purple-950/40'
                      }`}
                      onClick={() => { setSelectedRuleId(rule.id!); setResult(null) }}
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white">
                        <Wallet size={18} strokeWidth={2.2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-white">{rule.name}</p>
                        <p className="mt-0.5 text-[11px] font-bold text-violet-200/55">
                          Deposit {fmtPhp(rule.minDepositPhp)}{max}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                        <span className="rounded-full bg-fuchsia-400/15 px-2.5 py-1 text-[11px] font-black text-fuchsia-300">
                          {rule.chances} {t('spin.chances')}
                        </span>
                        <ChevronRight size={14} className="text-violet-400/50" />
                      </div>
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={onOpenWallet}
                className="mt-3 w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 to-violet-600 py-3.5 text-sm font-black text-white shadow-md shadow-fuchsia-500/25 active:opacity-85"
              >
                {t('spin.depositNow')}
              </button>
            </section>

            <section className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-900/70">
                  <Trophy size={14} className="text-amber-300" />
                </div>
                <h2 className="text-sm font-black text-violet-100">{t('spin.recentWins')}</h2>
              </div>
              <div className="overflow-hidden rounded-2xl border border-purple-700/30 bg-purple-950/35">
                {(status?.recentRecords ?? []).slice(0, 8).map((rec, idx) => (
                  <div
                    key={rec.id}
                    className="flex items-center justify-between gap-3 border-b border-purple-700/20 px-3.5 py-3 last:border-0"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                          idx === 0
                            ? 'bg-amber-400 text-purple-950'
                            : idx === 1
                              ? 'bg-fuchsia-600 text-white'
                              : idx === 2
                                ? 'bg-violet-700 text-violet-100'
                                : 'bg-purple-950 text-violet-400/70'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="truncate text-xs font-bold text-violet-100/80">{rec.displayName}</span>
                    </div>
                    <span className="flex-shrink-0 text-xs font-black text-amber-300">
                      {t('common.won')} {fmtPhp(rec.amountPhp)}
                    </span>
                  </div>
                ))}
                {status?.recentRecords.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs font-bold text-white/40">{t('spin.noRecords')}</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
