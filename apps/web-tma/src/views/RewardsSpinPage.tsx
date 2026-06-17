import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Gift, Loader2 } from 'lucide-react'
import { ApiError } from '@/api/client'
import { drawSpin, fetchSpinStatus, type SpinStatus, type SpinDrawResult } from '@/api/spin'
import { useWalletStore } from '@/stores/wallet'
import SpinWheel from '@/components/spin/SpinWheel'
import spinBg from '@/assets/spin/fbm/bg.webp'
import titleImg from '@/assets/spin/fbm/title.png'
import mascotLeftImg from '@/assets/spin/fbm/item-left.webp'
import mascotRightImg from '@/assets/spin/fbm/item-right.webp'
import winIconImg from '@/assets/spin/fbm/icon-win.webp'

interface Props {
  onOpenWallet: () => void
  onClose: () => void
}

function fmtPhp(amount: number): string {
  if (amount >= 1000) return `₱${Math.round(amount).toLocaleString('en-PH')}`
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

export default function RewardsSpinPage({ onOpenWallet, onClose }: Props) {
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
  const allEnabledPrizes = useMemo(() => status?.prizes.filter((p) => p.enabled) ?? [], [status])
  const wheelPrizes = useMemo(() => {
    const source = prizes.length >= 8 ? prizes : allEnabledPrizes.length > prizes.length ? allEnabledPrizes : prizes
    if (source.length >= 8) return source.slice(0, 8)
    if (source.length === 0) return []
    return Array.from({ length: 8 }, (_, i) => source[i % source.length])
  }, [allEnabledPrizes, prizes])
  const remaining = selectedRule?.remainingChances ?? status?.remainingChances ?? 0
  const canSpin = Boolean(selectedRule?.id && status?.enabled && remaining > 0 && wheelPrizes.length > 0)

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

  async function refreshStatus() {
    const next = await fetchSpinStatus()
    setStatus(next)
    setSelectedRuleId((current) => {
      if (current && next.depositRules.some((rule) => rule.id === current)) return current
      const available = next.depositRules.find((rule) => rule.enabled && (rule.remainingChances ?? 0) > 0)
      return available?.id ?? next.depositRules.find((rule) => rule.enabled)?.id ?? null
    })
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
      const desired = 360 - (idx * segment + segment / 2)
      setRotation((prev) => {
        const current = ((prev % 360) + 360) % 360
        const delta = (desired - current + 360) % 360
        return prev + 2160 + delta
      })
      window.setTimeout(async () => {
        setResult(res)
        setStatus((prev) => prev ? { ...prev, remainingChances: res.remainingChances } : prev)
        try {
          await wallet.refresh()
          await refreshStatus()
        } finally {
          setSpinning(false)
        }
      }, 5700)
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('spin.spinFailed'))
      setSpinning(false)
    }
  }

  return (
    <div className="page-main relative min-h-screen overflow-hidden bg-[#2448bd] pb-[calc(88px+env(safe-area-inset-bottom))] text-white">
      <div className="absolute inset-0 z-0 bg-cover bg-top" style={{ backgroundImage: `url(${spinBg})` }} />

      <header className="relative z-10 px-5 pt-[calc(var(--app-safe-top)+10px)]">
        <div className="flex items-center justify-between">
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#35aaf8] text-white shadow-lg shadow-blue-950/25 active:scale-95" onClick={onClose}>
            <ChevronLeft size={27} strokeWidth={3.2} />
          </button>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#35aaf8] text-white shadow-lg shadow-blue-950/25 active:scale-95" onClick={onOpenWallet}>
            <Gift size={25} strokeWidth={3} />
          </button>
        </div>
        <div className="mt-4 text-center">
          <img src={titleImg} alt="Rewards Spin" draggable={false} className="mx-auto w-[80%] max-w-[470px]" />
          <p className="mt-2 text-[clamp(1.1rem,5vw,1.9rem)] font-black text-[#fff8b6] drop-shadow-[0_2px_7px_rgba(255,255,160,0.55)]">
            {t('spin.remaining')}: {remaining}
          </p>
        </div>
      </header>

      <main className="relative z-10 mt-0">
        <img src={mascotLeftImg} alt="" draggable={false} className="spin-mascot-left pointer-events-none absolute left-0 top-[2vw] z-20 w-[21vw] max-w-[104px]" />
        <img src={mascotRightImg} alt="" draggable={false} className="spin-mascot-right pointer-events-none absolute right-2 top-[58vw] z-30 w-[21vw] max-w-[100px]" />

        <div className="px-0">
          <div className="relative mx-auto w-[86vw] max-w-[420px]">
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
              <div className="flex aspect-square items-center justify-center text-sm font-black text-white/70">
                {t('spin.noRecords')}
              </div>
            )}
          </div>
        </div>

        {message && <p className="mx-5 mt-3 rounded-xl bg-red-500/20 px-3 py-2 text-center text-xs font-black text-red-100">{message}</p>}
        {rules.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto px-2 pb-1 hide-scrollbar">
            {rules.map((rule, idx) => {
              const active = rule.id === selectedRule?.id
              return (
                <button
                  key={rule.id}
                  type="button"
                  className={`min-w-[126px] flex-shrink-0 rounded-t-xl px-2.5 py-2 text-center shadow-[0_3px_0_rgba(120,34,0,0.3)] active:scale-[0.98] ${
                    active ? 'bg-[#ff553d] text-white' : 'bg-gradient-to-b from-[#fff139] to-[#ffc312] text-[#7a2d25]'
                  }`}
                  onClick={() => { setSelectedRuleId(rule.id!); setResult(null); setMessage('') }}
                >
                  <p className="truncate text-sm font-black uppercase leading-none">
                    {idx === 0 ? 'VIP Exclusive' : `DEPOSIT ${Math.round(rule.minDepositPhp)}`}
                  </p>
                  <p className="mt-1 text-xs font-black">{rule.remainingChances ?? 0} {t('spin.chances')}</p>
                </button>
              )
            })}
          </div>
        )}

        <section className="mt-0 border-t-4 border-[#ff553d] bg-[#fff0e9] pb-3 text-[#0b4c2d]">
          {(status?.recentRecords ?? []).slice(0, 10).map((rec, idx) => (
            <div
              key={rec.id}
              className={`grid grid-cols-[1fr_1.35fr_0.9fr] items-center gap-2 px-4 py-2.5 text-[clamp(0.82rem,3.4vw,1.05rem)] font-black ${idx % 2 ? 'bg-[#ece3ff]' : 'bg-[#fff0e9]'}`}
            >
              <span className="truncate">{rec.displayName}</span>
              <span className="truncate text-center text-[#ff553d]">{t('common.won')} {fmtPhp(rec.amountPhp)}</span>
              <span className="text-right">{fmtDate(rec.createdAt)}</span>
            </div>
          ))}
          {status?.recentRecords.length === 0 && (
            <p className="px-5 py-8 text-center text-sm font-black text-[#0b4c2d]/55">{t('spin.noRecords')}</p>
          )}
        </section>

      </main>

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06102a]/72 px-8">
          <div className="relative w-full max-w-[370px] rounded-2xl bg-white px-8 pb-9 pt-28 text-center text-[#464646] shadow-[0_18px_44px_rgba(0,0,0,0.35)]">
            <img src={winIconImg} alt="" draggable={false} className="absolute left-1/2 top-[-72px] w-[190px] -translate-x-1/2" />
            <h2 className="text-2xl font-black">Congratulations!</h2>
            <p className="mt-5 text-xl leading-relaxed text-[#777]">
              You won {fmtPhp(result.amountPhp)}! Cash has been credited to your wallet.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="h-12 rounded-lg bg-[#b6b6b6] text-lg font-bold text-white active:scale-[0.98]"
                onClick={() => setResult(null)}
              >
                OK
              </button>
              <button
                type="button"
                className="h-12 rounded-lg bg-[#f42424] text-lg font-bold text-white active:scale-[0.98]"
                onClick={() => { setResult(null); void onSpin() }}
              >
                Spin Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
