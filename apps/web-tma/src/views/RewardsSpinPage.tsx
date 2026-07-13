import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, History, Loader2 } from 'lucide-react'
import { ApiError } from '@/api/client'
import { drawSpin, fetchSpinRecords, fetchSpinStatus, type SpinRecord, type SpinStatus, type SpinDrawResult } from '@/api/spin'
import { useWalletStore } from '@/stores/wallet'
import { useAuthStore } from '@/stores/auth'
import { analytics } from '@/utils/analytics'
import SpinWheel from '@/components/spin/SpinWheel'
import SpinWinnerTicker from '@/components/spin/SpinWinnerTicker'
import { computeSpinRotation, SPIN_ROTATION_MS } from '@/components/spin/spinWheelMath'
import spinBg from '@/assets/spin/fbm/bg.webp'
import titleImg from '@/assets/spin/fbm/title.png'
import mascotLeftImg from '@/assets/spin/fbm/item-left.webp'
import mascotRightImg from '@/assets/spin/fbm/item-right.webp'
import winIconImg from '@/assets/spin/fbm/icon-win.webp'
import oopsIconImg from '@/assets/spin/fbm/icon-oops.webp'

interface Props { onClose: () => void }

function fmtPhp(amount: number, currency = 'PHP'): string {
  if (currency !== 'PHP') return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  if (amount >= 1000) return `₱${Math.round(amount).toLocaleString('en-PH')}`
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtRecordDate(iso: string): string {
  try { return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso }
}

export default function RewardsSpinPage({ onClose }: Props) {
  const { t } = useTranslation()
  const wallet = useWalletStore()
  const user = useAuthStore((s) => s.user)
  const ensureLoggedIn = useAuthStore((s) => s.ensureLoggedIn)
  const [status, setStatus] = useState<SpinStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<SpinDrawResult | null>(null)
  const [oopsOpen, setOopsOpen] = useState(false)
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRecords, setHistoryRecords] = useState<SpinRecord[]>([])

  // 只保留每日签到转盘：仅显示签到三档
  const rules = useMemo(
    () => (status?.depositRules ?? []).filter((r) => r.enabled && r.id && r.kind === 'checkin'),
    [status],
  )
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
      const next = await fetchSpinStatus(ruleId ?? undefined, wallet.activeCurrency)
      setStatus(next)
      setSelectedRuleId((current) => {
        const inMode = next.depositRules.filter((rule) => rule.enabled && rule.kind === 'checkin')
        if (current && inMode.some((rule) => rule.id === current)) return current
        const available = inMode.find((rule) => (rule.remainingChances ?? 0) > 0)
        return available?.id ?? inMode[0]?.id ?? null
      })
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('spin.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function refreshStatus(ruleId?: number | null) {
    const next = await fetchSpinStatus(ruleId ?? selectedRuleId ?? undefined, wallet.activeCurrency)
    setStatus(next)
    setSelectedRuleId((current) => {
      const inMode = next.depositRules.filter((rule) => rule.enabled && rule.kind === 'checkin')
      if (current && inMode.some((rule) => rule.id === current)) return current
      const available = inMode.find((rule) => (rule.remainingChances ?? 0) > 0)
      return available?.id ?? inMode[0]?.id ?? null
    })
  }

  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wallet.activeCurrency])

  useEffect(() => {
    if (!selectedRuleId || loading) return
    void fetchSpinStatus(selectedRuleId, wallet.activeCurrency)
      .then((next) => {
        setStatus((prev) => prev ? { ...prev, tickerRecords: next.tickerRecords ?? [] } : prev)
      })
      .catch(() => {})
  }, [selectedRuleId, loading])

  async function onSpin() {
    if (spinning) return
    if (!user) { void ensureLoggedIn(t('auth.signInProfile')); return }
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
      const res = await drawSpin(selectedRule.id, wallet.activeCurrency)
      const idx = Math.max(0, wheelPrizes.findIndex((p) => p.id === res.prizeId))
      setRotation((prev) => computeSpinRotation(prev, idx, wheelPrizes.length))
      window.setTimeout(async () => {
        setResult(res)
        analytics.spinPrizeSuccess(res.amountPhp, res.prizeId, res.recordId)
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

  async function openHistory() {
    setHistoryOpen(true)
    setHistoryLoading(true)
    try {
      const res = await fetchSpinRecords(1, 30)
      setHistoryRecords(res.items)
    } catch {
      setHistoryRecords([])
    } finally {
      setHistoryLoading(false)
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
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#35aaf8] text-white shadow-lg shadow-blue-950/25 active:scale-95" onClick={() => void openHistory()}>
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
                    {rule.checkinTier ? t(`checkin.tier.${rule.checkinTier}`) : t('spin.checkinTab')}
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
              You won {fmtPhp(result.amountPhp, result.currency)}! Cash has been credited to your wallet.
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
              {t('spin.oopsBodyCheckin')}
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

      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#06102a]/72 px-0">
          <div className="max-h-[76vh] w-full max-w-[430px] rounded-t-3xl bg-[#fff0e9] text-[#0b4c2d] shadow-[0_-18px_44px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between border-b-4 border-[#ff553d] px-5 py-4">
              <h2 className="text-lg font-black">{t('spin.historyTitle')}</h2>
              <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#35aaf8] text-white active:scale-95" onClick={() => setHistoryOpen(false)}>
                <ChevronLeft size={22} className="-rotate-90" strokeWidth={3} />
              </button>
            </div>
            <div className="max-h-[calc(76vh-72px)] overflow-y-auto px-4 py-3">
              {historyLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 size={28} className="animate-spin text-[#ff553d]" />
                </div>
              ) : historyRecords.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm font-bold text-[#0b4c2d]/55">
                  {t('spin.noHistory')}
                </div>
              ) : (
                <div className="space-y-2">
                  {historyRecords.map((record) => (
                    <div key={record.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-[#0b4c2d]">{record.prizeName}</p>
                        <p className="mt-1 text-xs font-bold text-[#0b4c2d]/55">{fmtRecordDate(record.createdAt)}</p>
                      </div>
                      <p className="self-center whitespace-nowrap text-base font-black text-[#ff553d]">+{fmtPhp(record.amountPhp, record.currency)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
