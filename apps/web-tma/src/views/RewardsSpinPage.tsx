import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Gift, Headphones, Loader2, Wallet } from 'lucide-react'
import { ApiError } from '@/api/client'
import { drawSpin, fetchSpinStatus, type SpinStatus, type SpinDrawResult } from '@/api/spin'
import { useWalletStore } from '@/stores/wallet'
import SpinWheel from '@/components/spin/SpinWheel'
import spinBg from '@/assets/spin/decor/bg.webp'
import giftBoxImg from '@/assets/spin/decor/gift-box.webp'
import mascotLeftImg from '@/assets/spin/decor/mascot-left.webp'
import mascotRightImg from '@/assets/spin/decor/mascot-right.webp'

interface Props {
  onOpenWallet: () => void
  onOpenCs: () => void
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

export default function RewardsSpinPage({ onOpenWallet, onOpenCs, onClose }: Props) {
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
        return prev + 1800 + delta
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
      }, 4300)
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('spin.spinFailed'))
      setSpinning(false)
    }
  }

  return (
    <div className="page-main min-h-screen overflow-hidden bg-[#183d9b] pb-5 text-white">
      <div className="fixed inset-0 -z-10 bg-cover bg-top" style={{ backgroundImage: `url(${spinBg})` }} />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_50%_22%,rgba(255,255,255,0.18),transparent_22%),linear-gradient(180deg,rgba(33,75,185,0.12),rgba(25,40,132,0.72))]" />

      <header className="relative px-5 pt-[calc(var(--app-safe-top)+16px)]">
        <div className="flex items-center justify-between">
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-400/90 text-white shadow-lg shadow-blue-950/25 active:scale-95" onClick={onClose}>
            <ChevronLeft size={28} strokeWidth={3} />
          </button>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-400/90 text-white shadow-lg shadow-blue-950/25 active:scale-95" onClick={onOpenWallet}>
            <Gift size={26} strokeWidth={2.8} />
          </button>
        </div>
        <div className="mt-5 text-center">
          <h1 className="font-display text-[clamp(3.2rem,14vw,5.6rem)] font-black leading-none tracking-normal">
            <span className="text-[#f0ce00] drop-shadow-[0_5px_0_rgba(79,53,58,0.72)]">Rewards</span>
            <span className="ml-3 text-[#fff7dd] drop-shadow-[0_5px_0_rgba(43,52,107,0.7)]">Spin</span>
          </h1>
          <p className="mt-3 text-[clamp(1.35rem,5.8vw,2.4rem)] font-black text-[#fff8b6] drop-shadow-[0_2px_7px_rgba(255,255,160,0.55)]">
            {t('spin.remaining')}: {remaining}
          </p>
        </div>
      </header>

      <main className="relative mt-3">
        <img src={mascotLeftImg} alt="" draggable={false} className="spin-mascot-left pointer-events-none absolute left-0 top-3 z-10 w-[27vw] max-w-[128px]" />
        <img src={giftBoxImg} alt="" draggable={false} className="spin-gift-float pointer-events-none absolute left-1/2 top-0 z-10 w-[15vw] max-w-[72px] -translate-x-1/2" />
        <img src={mascotRightImg} alt="" draggable={false} className="spin-mascot-right pointer-events-none absolute right-1 top-[54vw] z-20 w-[27vw] max-w-[128px]" />

        <div className="px-4">
          <div className="relative mx-auto max-w-[430px] rounded-[34px] bg-gradient-to-b from-cyan-400/55 via-indigo-500/35 to-purple-700/65 p-2 shadow-[0_18px_38px_rgba(20,18,96,0.45)]">
            {loading ? (
              <div className="flex aspect-square items-center justify-center">
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
        {result && (
          <div className="mx-5 mt-3 rounded-2xl border border-yellow-200/60 bg-gradient-to-r from-[#ff4b37] to-[#ffc927] px-4 py-3 text-center shadow-lg shadow-orange-900/25">
            <p className="text-xs font-black uppercase text-white/85">{t('spin.youWon')}</p>
            <p className="mt-0.5 font-display text-3xl font-black text-white drop-shadow">{fmtPhp(result.amountPhp)}</p>
          </div>
        )}

        {rules.length > 0 && (
          <div className="mt-4 flex gap-3 overflow-x-auto px-3 pb-1 hide-scrollbar">
            {rules.map((rule, idx) => {
              const active = rule.id === selectedRule?.id
              return (
                <button
                  key={rule.id}
                  type="button"
                  className={`min-w-[150px] flex-shrink-0 rounded-t-2xl px-3 py-2.5 text-center shadow-[0_4px_0_rgba(120,34,0,0.3)] active:scale-[0.98] ${
                    active ? 'bg-[#ff5139] text-white' : 'bg-gradient-to-b from-[#fff139] to-[#ffc312] text-[#7a2d25]'
                  }`}
                  onClick={() => { setSelectedRuleId(rule.id!); setResult(null); setMessage('') }}
                >
                  <p className="truncate text-lg font-black uppercase leading-none">
                    {idx === 0 ? 'VIP Exclusive' : `DEPOSIT ${Math.round(rule.minDepositPhp)}`}
                  </p>
                  <p className="mt-1 text-sm font-black">{rule.remainingChances ?? 0} {t('spin.chances')}</p>
                </button>
              )
            })}
          </div>
        )}

        <section className="mt-0 border-t-4 border-[#ff5139] bg-[#fff0e9] pb-3 text-[#0b4c2d]">
          {(status?.recentRecords ?? []).slice(0, 10).map((rec, idx) => (
            <div
              key={rec.id}
              className={`grid grid-cols-[1fr_1.35fr_0.9fr] items-center gap-2 px-5 py-3 text-[clamp(0.95rem,4vw,1.35rem)] font-black ${idx % 2 ? 'bg-[#ece3ff]' : 'bg-[#fff0e9]'}`}
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

        <button
          type="button"
          onClick={onOpenCs}
          className="fixed bottom-5 right-5 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-[#f61e1e] text-white shadow-[0_8px_18px_rgba(91,0,0,0.35)] active:scale-95"
        >
          <Headphones size={34} strokeWidth={2.5} />
        </button>
        {!canSpin && !loading && (
          <button
            type="button"
            onClick={onOpenWallet}
            className="fixed bottom-5 left-5 z-40 flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-yellow-300 to-orange-400 px-4 text-sm font-black text-[#7a2d25] shadow-[0_8px_18px_rgba(91,38,0,0.28)] active:scale-95"
          >
            <Wallet size={18} strokeWidth={2.6} />
            {t('spin.depositNow')}
          </button>
        )}
      </main>
    </div>
  )
}
