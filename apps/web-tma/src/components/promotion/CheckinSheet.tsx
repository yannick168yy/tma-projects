import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Check } from 'lucide-react'
import { fetchCheckinStatus, claimCheckin, type CheckinStatus, type CheckinTier, type CheckinClaimResult } from '@/api/promotion'
import { fetchSpinStatus } from '@/api/spin'
import { ApiError } from '@/api/client'
import { useWalletStore } from '@/stores/wallet'
import heroImg from '@/assets/spin/checkin/hero.webp'
import wheelImg from '@/assets/spin/checkin/wheel.webp'

interface Props {
  open: boolean
  onClose: () => void
  onOpenSpin: () => void
}

const TIER_TEXT: Record<CheckinTier, string> = {
  starter: 'text-white/90',
  premium: 'text-sky-300',
  elite: 'text-amber-300',
}
const TIER_BAR: Record<CheckinTier, string> = {
  starter: 'bg-white/70',
  premium: 'bg-sky-400',
  elite: 'bg-amber-400',
}

const Wheel = ({ className = '' }: { className?: string }) => (
  <img src={wheelImg} alt="" draggable={false} className={`rounded-full ${className}`} />
)

/** ⭐ 标题 ⭐ + 两侧渐隐金线 */
function SectionTitle({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="h-px w-6 bg-gradient-to-l from-amber-400 to-transparent" />
      <span className="text-base leading-none">⭐</span>
      <span className="whitespace-nowrap font-display text-[22px] font-black tracking-wide text-white">{text}</span>
      <span className="text-base leading-none">⭐</span>
      <span className="h-px w-6 bg-gradient-to-r from-amber-400 to-transparent" />
    </div>
  )
}

export default function CheckinSheet({ open, onClose, onOpenSpin }: Props) {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<CheckinStatus | null>(null)
  const [spinRemaining, setSpinRemaining] = useState(0)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [result, setResult] = useState<CheckinClaimResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [st, spin] = await Promise.all([
        fetchCheckinStatus(),
        fetchSpinStatus().catch(() => null),
      ])
      setStatus(st)
      if (spin) {
        setSpinRemaining(
          (spin.depositRules ?? [])
            .filter((r) => r.kind === 'checkin')
            .reduce((sum, r) => sum + (r.remainingChances ?? 0), 0),
        )
      }
    }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!open) return
    setResult(null)
    setError(null)
    void load()
  }, [open, load])

  async function onClaim() {
    setClaiming(true)
    setError(null)
    try {
      const res = await claimCheckin()
      setResult(res)
      void useWalletStore.getState().refresh()
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Check-in failed')
    } finally {
      setClaiming(false)
    }
  }

  if (!open) return null

  const tierLabel = (tier: CheckinTier) => t(`checkin.tier.${tier}`)
  const canClaimNow = !!status && !status.todayClaimed
  const canUpgrade = !!status && status.todayClaimed && status.canUpgradeToday
  const ctaDisabled = claiming || (!canClaimNow && !canUpgrade)

  /** 以今日为基准,按 cycle 偏移推算星期几标签(今日列落在当天星期,前后自然对齐) */
  const weekdayLabel = (offset: number) => {
    if (!status) return ''
    const ms = Date.parse(`${status.today}T00:00:00Z`) + offset * 86400_000
    return new Date(ms).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' }).toUpperCase()
  }

  return (
    <div className="fixed inset-0 z-[94] flex items-end justify-center bg-black/70">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex max-h-[100dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[28px] bg-gradient-to-b from-[#2b2792] via-[#272184] to-[#201c6c] pt-5">
        <button
          type="button"
          className="absolute right-3 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full text-white/90 ring-1 ring-white/50 active:scale-95"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {/* Hero:标题/独角兽/转盘为设计图切图,Your Spins 数值动态覆盖 */}
        <div className="relative flex-none">
          <img src={heroImg} alt="" className="block w-full select-none" draggable={false} />

          {/* Your Spins 动态卡:盖住设计图内写死的 "1",数值来自签到转盘剩余次数 */}
          <button
            type="button"
            disabled={spinRemaining <= 0}
            onClick={() => { if (spinRemaining > 0) { onOpenSpin(); onClose() } }}
            className="absolute flex flex-col justify-center rounded-2xl border border-[#524cbd] bg-[#312c98] px-[6%] text-left disabled:cursor-default"
            style={{ left: '4.3%', top: '66%', width: '27%', height: '26%' }}
          >
            <span className="whitespace-nowrap text-[11px] font-bold leading-tight text-indigo-100">{t('checkin.yourSpins')}</span>
            <div className="mt-1 flex items-center gap-1">
              <span className="font-display text-[21px] font-black leading-none text-amber-400">{spinRemaining}</span>
              <Wheel className="h-[22px] w-[22px]" />
            </div>
          </button>
        </div>

        {/* 主体:内容自适应高度,不滚动 */}
        <div className="flex flex-col gap-3 px-3 pb-5 pt-3">
          {loading && <div className="py-10 text-center text-sm text-white/60">…</div>}

          {!loading && status && status.enabled === false && (
            <p className="py-10 text-center text-sm text-white/70">{t('checkin.disabled')}</p>
          )}

          {!loading && status && status.enabled !== false && (
            <>
              {/* ── This Week ── */}
              <section className="rounded-2xl border border-white/12 bg-[#2c2793] p-3">
                <SectionTitle text={t('checkin.thisWeek')} />
                <div className="mt-3.5 grid grid-cols-7 gap-1.5">
                  {status.cycle.map((c) => {
                    const done = c.day < status.cycleDay || (c.day === status.cycleDay && status.todayClaimed)
                    const active = c.day === status.cycleDay && !status.todayClaimed
                    const isPremiumDay = c.base.tier !== 'starter'
                    return (
                      <div
                        key={c.day}
                        className={`relative flex flex-col items-center gap-1.5 rounded-xl px-0.5 py-2.5 ${
                          active ? 'border-2 border-amber-400 bg-[#37329e]'
                          : done ? 'bg-[#37329e]'
                          : 'border border-dashed border-[#6f68cf]'
                        }`}
                      >
                        <span className="text-[10px] font-bold text-white/70">{weekdayLabel(c.day - status.cycleDay)}</span>
                        {done
                          ? <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5a3fcc]"><Check size={18} strokeWidth={3.5} className="text-white" /></span>
                          : <Wheel className="h-8 w-8" />}
                        <span className="text-[14px] font-black leading-none text-white">×{c.base.n}</span>
                        {active
                          ? (
                            <button
                              type="button"
                              disabled={claiming}
                              onClick={() => void onClaim()}
                              className="mt-0.5 rounded-md bg-amber-400 px-2 py-0.5 text-[10px] font-black text-[#3a2a05] active:scale-95"
                            >
                              {t('checkin.claimShort')}
                            </button>
                          )
                          : isPremiumDay
                            ? <span className={`text-[9px] font-bold leading-none ${TIER_TEXT[c.base.tier]}`}>{tierLabel(c.base.tier)}</span>
                            : <span className="h-[11px]" />}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-black/15 px-4 py-2.5 text-[12px] text-indigo-200/80">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] ring-1 ring-indigo-200/60">i</span>
                  {t('checkin.streakResetHint')}
                </div>
              </section>

              {/* ── Monthly Milestones ── */}
              <section className="rounded-2xl border border-white/12 bg-[#2c2793] p-3">
                <SectionTitle text={t('checkin.milestoneTitle')} />
                <p className="mt-1.5 text-center text-[12px] text-indigo-200/80">{t('checkin.milestoneSubtitle')}</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {status.milestones.map((m) => {
                    const frac = Math.max(0, Math.min(1, status.monthDays / m.atDays))
                    return (
                      <div key={m.atDays} className="flex flex-col rounded-xl border border-white/10 bg-[#37329e] px-3 py-3">
                        <div className="flex items-baseline gap-1">
                          <span className="text-lg font-black leading-none text-white">{m.atDays}</span>
                          <span className="text-[11px] font-bold text-white/70">{t('checkin.daysWord')}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Wheel className="h-5 w-5" />
                          <span className={`text-[12px] font-black leading-tight ${TIER_TEXT[m.tier]}`}>{tierLabel(m.tier)}×{m.n}</span>
                        </div>
                        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                          <div className={`h-full rounded-full ${TIER_BAR[m.tier]}`} style={{ width: `${frac * 100}%` }} />
                        </div>
                        <span className="mt-1.5 text-center text-[10px] font-bold text-white/60">{status.monthDays}/{m.atDays}</span>
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* ── 结果/报错 + CTA + 页脚 ── */}
              <div className="mt-0.5">
                {result && (
                  <div className="mb-2 rounded-2xl border border-amber-400/40 bg-[#37329e] p-3 text-center">
                    <p className="text-base font-black text-white">🎉 {t('checkin.gotSpins', { n: result.grantedChances })}</p>
                    <button
                      type="button"
                      className="mt-2 w-full rounded-full bg-gradient-to-b from-[#fbcf3f] to-[#f0a91e] py-2.5 text-sm font-black text-[#3a2a05] active:scale-95"
                      onClick={() => { onOpenSpin(); onClose() }}
                    >
                      {t('checkin.goSpin')}
                    </button>
                  </div>
                )}
                {error && <p className="mb-2 text-center text-xs text-red-300">{error}</p>}

                {!result && (
                  <button
                    type="button"
                    disabled={ctaDisabled}
                    onClick={() => void onClaim()}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#fbcf3f] to-[#f0a91e] py-3 text-lg font-black text-[#3a2a05] shadow-[0_6px_20px_-6px_rgba(245,194,58,0.7)] transition-opacity active:scale-[0.98] disabled:opacity-45"
                  >
                    <Wheel className="h-7 w-7" />
                    {claiming ? t('checkin.claiming')
                      : canUpgrade ? t('checkin.claimEnhanced')
                      : status.todayClaimed ? t('checkin.claimed')
                      : t('checkin.ctaCheckin')}
                  </button>
                )}
                <p className="mt-2.5 text-center text-[12px] text-indigo-200/70">{t('checkin.comeBackTomorrow')}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
