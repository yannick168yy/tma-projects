import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, History, Loader2 } from 'lucide-react'
import { ApiError } from '@/api/client'
import { drawSpin, fetchSpinStatus, type SpinStatus, type SpinDrawResult } from '@/api/spin'
import { useWalletStore } from '@/stores/wallet'
import SpinWheel from '@/components/spin/SpinWheel'
import SpinWinnerTicker from '@/components/spin/SpinWinnerTicker'
import { computeSpinRotation, SPIN_ROTATION_MS } from '@/components/spin/spinWheelMath'
import spinBg from '@/assets/spin/fbm/bg.webp'
import titleImg from '@/assets/spin/fbm/title.png'
import mascotLeftImg from '@/assets/spin/fbm/item-left.webp'
import mascotRightImg from '@/assets/spin/fbm/item-right.webp'
import winIconImg from '@/assets/spin/fbm/icon-win.webp'
import oopsIconImg from '@/assets/spin/fbm/icon-oops.webp'

interface Props {
  onOpenHistory: () => void
  onClose: () => void
}

function fmtPhp(amount: number): string {
  if (amount >= 1000) return `₱${Math.round(amount).toLocaleString('en-PH')}`
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDepositAmount(amount: number): string {
  return Math.round(amount).toLocaleString('en-PH')
}

export default function RewardsSpinPage({ onOpenHistory, onClose }: Props) {
  const { t } = useTranslation()
  const wallet = useWalletStore()
  const [status, setStatus] = useState<SpinStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<SpinDrawResult | null>(null)
  const [oopsOpen, setOopsOpen] = useState(false)
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
  const allEnabledPrizes = useMemo(() => status?.prizes.filter((p) => p.enabled) ?? [], [status])
  const wheelPrizes = useMemo(() => {
    const source = prizes.length >= 8 ? prizes : allEnabledPrizes.length > prizes.length ? allEnabledPrizes : prizes
    if (source.length >= 8) return source.slice(0, 8)
    if (source.length === 0) return []
    return Array.from({ length: 8 }, (_, i) => source[i % source.length])
  }, [allEnabledPrizes, prizes])
  const remaining = selectedRule?.remainingChances ?? status?.remainingChances ?? 0
  const selectedAmount = selectedRule ? Number(selectedRule.depositAmountPhp ?? selectedRule.minDepositPhp) : 580
  const canSpin = Boolean(selectedRule?.id && status?.enabled && remaining > 0 && wheelPrizes.length > 0)
  const tickerRecords = status?.tickerRecords ?? []

  useEffect(() => {
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [])

  async function load(ruleId?: number | null) {
    setLoading(true)
    try {
      const next = await fetchSpinStatus(ruleId ?? undefined)
      setStatus(next)
      setSelectedRuleId((current) => {
        const nextId = current ?? null
        if (nextId && next.depositRules.some((rule) => rule.id === nextId)) return nextId
        const available = next.depositRules.find((rule) => rule.enabled && (rule.remainingChances ?? 0) > 0)
        return available?.id ?? next.depositRules.find((rule) => rule.enabled)?.id ?? null
      })
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('spin.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function refreshStatus(ruleId?: number | null) {
    const next = await fetchSpinStatus(ruleId ?? selectedRuleId ?? undefined)
    setStatus(next)
    setSelectedRuleId((current) => {
      if (current && next.depositRules.some((rule) => rule.id === current)) return current
      const available = next.depositRules.find((rule) => rule.enabled && (rule.remainingChances ?? 0) > 0)
      return available?.id ?? next.depositRules.find((rule) => rule.enabled)?.id ?? null
    })
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (!selectedRuleId || loading) return
    void fetchSpinStatus(selectedRuleId)
      .then((next) => {
        setStatus((prev) => prev ? { ...prev, tickerRecords: next.tickerRecords ?? [] } : prev)
      })
      .catch(() => {})
  }, [selectedRuleId, loading])

  async function onSpin() {
    if (spinning) return
    if (!canSpin) {
      setOopsOpen(true)
      setResult(null)
      setMessage('')
      return
    }
    if (!selectedRule?.id) return
    setSpinning(true)
    setResult(null)
    setMessage('')
    try {
      const res = await drawSpin(selectedRule.id)
      const idx = Math.max(0, wheelPrizes.findIndex((p) => p.id === res.prizeId))
      setRotation((prev) => computeSpinRotation(prev, idx, wheelPrizes.length))
      window.setTimeout(async () => {
        setResult(res)
        setStatus((prev) => prev ? { ...prev, remainingChances: res.remainingChances } : prev)
        try {
          await wallet.refresh()
          await refreshStatus(selectedRule.id)
        } finally {
          setSpinning(false)
        }
      }, SPIN_ROTATION_MS + 200)
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('spin.spinFailed'))
      setSpinning(false)
    }
  }

  return (
    <div className="spin-page fixed inset-x-0 top-0 z-10 mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#2448bd] text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-cover bg-top" style={{ backgroundImage: `url(${spinBg})` }} />

      <header className="relative z-10 flex-shrink-0 px-5 pt-[calc(var(--app-safe-top)+10px)]">
        <div className="flex items-center justify-between">
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#35aaf8] text-white shadow-lg shadow-blue-950/25 active:scale-95" onClick={onClose}>
            <ChevronLeft size={27} strokeWidth={3.2} />
          </button>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#35aaf8] text-white shadow-lg shadow-blue-950/25 active:scale-95" onClick={onOpenHistory}>
            <History size={25} strokeWidth={3} />
          </button>
        </div>
        <div className="mt-2 text-center">
          <img src={titleImg} alt="Rewards Spin" draggable={false} className="mx-auto w-[72%] max-w-[400px]" />
          <p className="mt-1 text-[clamp(1rem,4.6vw,1.65rem)] font-black text-[#fff8b6] drop-shadow-[0_2px_7px_rgba(255,255,160,0.55)]">
            {t('spin.remaining')}: {remaining}
          </p>
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1" aria-hidden />
        <img src={mascotLeftImg} alt="" draggable={false} className="spin-mascot-left pointer-events-none absolute left-0 top-[2vw] z-20 w-[21vw] max-w-[104px]" />
        <img src={mascotRightImg} alt="" draggable={false} className="spin-mascot-right pointer-events-none absolute right-2 top-[66vw] z-30 w-[21vw] max-w-[100px]" />

        <div className="relative z-10 flex-shrink-0 px-0">
          <div className="relative mx-auto w-[88vw] max-w-[405px]">
            {loading ? (
              <div className="flex aspect-[760/838] items-center justify-center">
                <Loader2 size={34} className="animate-spin text-white/80" />
              </div>
            ) : wheelPrizes.length > 0 ? (
              <SpinWheel
                prizes={wheelPrizes}
                rotation={rotation}
                spinning={spinning}
                disabled={!canSpin}
                spinLabel={t('spin.spinBtn')}
                onSpin={() => void onSpin()}
              />
            ) : (
              <div className="flex aspect-[760/838] items-center justify-center text-sm font-normal text-white/70">
                {t('spin.noRecords')}
              </div>
            )}
          </div>
        </div>

        {message && <p className="mx-5 mt-1 flex-shrink-0 rounded-xl bg-red-500/20 px-3 py-2 text-center text-xs font-black text-red-100">{message}</p>}

        {rules.length > 0 && (
          <div className="flex flex-shrink-0 gap-2 overflow-x-auto px-1 pb-0 hide-scrollbar">
            {rules.map((rule) => {
              const active = rule.id === selectedRule?.id
              return (
                <button
                  key={rule.id}
                  type="button"
                  className={`min-w-[118px] flex-shrink-0 rounded-t-xl px-2.5 py-1.5 text-center shadow-[0_3px_0_rgba(120,34,0,0.3)] active:scale-[0.98] ${
                    active ? 'bg-[#ff553d] text-white' : 'bg-gradient-to-b from-[#fff139] to-[#ffc312] text-[#7a2d25]'
                  }`}
                  onClick={() => { setSelectedRuleId(rule.id!); setResult(null); setMessage('') }}
                >
                  <p className="truncate text-sm font-black uppercase leading-none">
                    DEPOSIT {fmtDepositAmount(Number(rule.depositAmountPhp ?? rule.minDepositPhp))}
                  </p>
                  <p className="mt-1 text-xs font-black">{rule.remainingChances ?? 0} {t('spin.chances')}</p>
                </button>
              )
            })}
          </div>
        )}

        <SpinWinnerTicker records={tickerRecords} />
      </main>

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06102a]/72 px-8">
          <div className="relative w-full max-w-[370px] rounded-2xl bg-white px-8 pb-8 pt-24 text-center text-[#464646] shadow-[0_18px_44px_rgba(0,0,0,0.35)]">
            <img src={winIconImg} alt="" draggable={false} className="absolute left-1/2 top-[-64px] w-[170px] -translate-x-1/2" />
            <h2 className="text-xl font-black">Congratulations!</h2>
            <p className="mt-4 text-base leading-relaxed text-[#777]">
              You won {fmtPhp(result.amountPhp)}! Cash has been credited to your wallet.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="h-11 rounded-lg bg-[#b6b6b6] text-base font-bold text-white active:scale-[0.98]"
                onClick={() => setResult(null)}
              >
                OK
              </button>
              <button
                type="button"
                className="h-11 rounded-lg bg-[#f42424] text-base font-bold text-white active:scale-[0.98]"
                onClick={() => { setResult(null); void onSpin() }}
              >
                Spin Again
              </button>
            </div>
          </div>
        </div>
      )}

      {oopsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06102a]/72 px-8">
          <div className="relative w-full max-w-[370px] rounded-2xl bg-white px-8 pb-8 pt-24 text-center text-[#464646] shadow-[0_18px_44px_rgba(0,0,0,0.35)]">
            <img src={oopsIconImg} alt="" draggable={false} className="absolute left-1/2 top-[-62px] w-[158px] -translate-x-1/2" />
            <h2 className="text-xl font-black">{t('spin.oopsTitle')}</h2>
            <p className="mt-4 text-base leading-relaxed text-[#777]">
              {t('spin.oopsBody', { amount: fmtDepositAmount(selectedAmount) })}
            </p>
            <button
              type="button"
              className="mt-7 h-11 w-full rounded-lg bg-[#f42424] text-base font-bold text-white active:scale-[0.98]"
              onClick={() => setOopsOpen(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
