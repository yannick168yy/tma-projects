import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { fetchCheckinStatus, claimCheckin, type CheckinStatus, type CheckinTier, type CheckinClaimResult } from '@/api/promotion'
import { fetchSpinStatus } from '@/api/spin'
import { ApiError } from '@/api/client'
import { useWalletStore } from '@/stores/wallet'
import heroImg from '@/assets/spin/checkin/hero.webp'
import wheelImg from '@/assets/spin/checkin/wheel.webp'
import checkedImg from '@/assets/spin/checkin/checked.webp'

interface Props {
  open: boolean
  onClose: () => void
  onOpenSpin: () => void
}

const TIER_TEXT: Record<CheckinTier, string> = {
  starter: 'text-white/85',
  premium: 'text-sky-300',
  elite: 'text-amber-300',
}
const TIER_BAR: Record<CheckinTier, string> = {
  starter: 'bg-white/60',
  premium: 'bg-sky-400',
  elite: 'bg-amber-400',
}

/** ⭐ 标题 ⭐ + 两侧渐隐金线 */
function SectionTitle({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="h-px w-10 bg-gradient-to-l from-amber-400 to-transparent" />
      <span className="text-sm leading-none">⭐</span>
      <span className="font-display text-base font-black tracking-wide text-white">{text}</span>
      <span className="text-sm leading-none">⭐</span>
      <span className="h-px w-10 bg-gradient-to-r from-amber-400 to-transparent" />
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

  /** 以今日为基准，按 cycle 偏移推算星期几标签（今日列落在当天星期，前后自然对齐） */
  const weekdayLabel = (offset: number) => {
    if (!status) return ''
    const ms = Date.parse(`${status.today}T00:00:00Z`) + offset * 86400_000
    return new Date(ms).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' }).toUpperCase()
  }

  return (
    <div className="fixed inset-0 z-[94] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-t-3xl bg-gradient-to-b from-[#1a1240] via-[#171136] to-[#0f0b26]">
        <div className="overflow-y-auto pb-6">
          {/* Hero:标题/独角兽/转盘为设计图,Your Spins 数值动态覆盖 */}
          <div className="relative">
            <img src={heroImg} alt="" className="block w-full select-none" draggable={false} />
            <button
              type="button"
              className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 ring-1 ring-white/30 backdrop-blur active:scale-95"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>

            {/* Your Spins 动态卡:不透明,完整遮盖设计图内写死的 "1" */}
            <button
              type="button"
              disabled={spinRemaining <= 0}
              onClick={() => { if (spinRemaining > 0) { onOpenSpin(); onClose() } }}
              className="absolute flex flex-col justify-center rounded-[14px] bg-gradient-to-b from-[#312a6b] to-[#241a52] px-[6%] text-left ring-1 ring-white/10 disabled:cursor-default"
              style={{ left: '2.6%', top: '48.5%', width: '30.5%', height: '25%' }}
            >
              <span className="whitespace-nowrap text-[12px] font-bold leading-tight text-white">{t('checkin.yourSpins')}</span>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="font-display text-[30px] font-black leading-none text-amber-400">{spinRemaining}</span>
                <img src={wheelImg} alt="" className="h-8 w-8" draggable={false} />
              </div>
            </button>
          </div>

          <div className="px-4">
            {loading && <div className="py-12 text-center text-sm text-white/50">…</div>}

            {!loading && status && status.enabled === false && (
              <p className="py-12 text-center text-sm text-white/60">{t('checkin.disabled')}</p>
            )}

            {!loading && status && status.enabled !== false && (
              <>
                {/* ── This Week ── */}
                <section className="mt-1 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                  <SectionTitle text={t('checkin.thisWeek')} />
                  <div className="mt-3 grid grid-cols-7 gap-1">
                    {status.cycle.map((c) => {
                      const done = c.day < status.cycleDay || (c.day === status.cycleDay && status.todayClaimed)
                      const active = c.day === status.cycleDay && !status.todayClaimed
                      const isPremiumDay = c.base.tier !== 'starter'
                      return (
                        <div
                          key={c.day}
                          className={`relative flex flex-col items-center gap-1 rounded-xl px-0.5 py-2 ${
                            active ? 'bg-amber-400/10 ring-2 ring-amber-400'
                            : done ? 'bg-white/[0.06] ring-1 ring-white/10'
                            : 'border border-dashed border-purple-300/40'
                          }`}
                        >
                          <span className="text-[9px] font-bold text-white/55">{weekdayLabel(c.day - status.cycleDay)}</span>
                          <img src={done ? checkedImg : wheelImg} alt="" className="h-6 w-6" draggable={false} />
                          <span className="text-[13px] font-black leading-none text-white">×{c.base.n}</span>
                          {active
                            ? (
                              <button
                                type="button"
                                disabled={claiming}
                                onClick={() => void onClaim()}
                                className="mt-0.5 rounded-md bg-amber-400 px-2 py-0.5 text-[9px] font-black text-[#3a2a00] active:scale-95"
                              >
                                {t('checkin.claimShort')}
                              </button>
                            )
                            : isPremiumDay
                              ? <span className={`text-[8px] font-bold leading-none ${TIER_TEXT[c.base.tier]}`}>{tierLabel(c.base.tier)}</span>
                              : <span className="h-[10px]" />}
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-purple-200/70">
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] ring-1 ring-purple-200/50">i</span>
                    {t('checkin.streakResetHint')}
                  </p>
                </section>

                {/* ── Monthly Milestones ── */}
                <section className="mt-4 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                  <SectionTitle text={t('checkin.milestoneTitle')} />
                  <p className="mt-1.5 text-center text-[11px] text-purple-200/70">{t('checkin.milestoneSubtitle')}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {status.milestones.map((m) => {
                      const frac = Math.max(0, Math.min(1, status.monthDays / m.atDays))
                      return (
                        <div key={m.atDays} className="flex flex-col rounded-xl bg-black/20 px-2.5 py-3 ring-1 ring-white/10">
                          <div className="flex items-baseline gap-1">
                            <span className="text-lg font-black leading-none text-white">{m.atDays}</span>
                            <span className="text-[11px] font-bold text-white/60">{t('checkin.daysWord')}</span>
                          </div>
                          <div className="mt-2 flex items-center gap-1">
                            <img src={wheelImg} alt="" className="h-5 w-5" draggable={false} />
                            <span className={`text-[11px] font-black leading-tight ${TIER_TEXT[m.tier]}`}>{tierLabel(m.tier)}×{m.n}</span>
                          </div>
                          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div className={`h-full rounded-full ${TIER_BAR[m.tier]}`} style={{ width: `${frac * 100}%` }} />
                          </div>
                          <span className="mt-1.5 text-center text-[10px] font-bold text-white/45">{status.monthDays}/{m.atDays}</span>
                        </div>
                      )
                    })}
                  </div>
                </section>

                {/* ── 领取结果 / 报错 ── */}
                {result && (
                  <div className="mt-4 rounded-2xl bg-gradient-to-br from-amber-500/20 to-primary/20 p-4 text-center ring-1 ring-primary/40">
                    <p className="text-lg font-black text-white">🎉 {t('checkin.gotSpins', { n: result.grantedChances })}</p>
                    <button
                      type="button"
                      className="mt-3 w-full rounded-full bg-primary py-3 text-sm font-black text-primary-foreground active:scale-95"
                      onClick={() => { onOpenSpin(); onClose() }}
                    >
                      {t('checkin.goSpin')}
                    </button>
                  </div>
                )}
                {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}

                {/* ── 主按钮 ── */}
                {!result && (
                  <button
                    type="button"
                    disabled={ctaDisabled}
                    onClick={() => void onClaim()}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 py-3.5 text-lg font-black text-[#3a2a00] shadow-[0_6px_20px_-6px_rgba(251,191,36,0.6)] transition-opacity active:scale-[0.98] disabled:opacity-45"
                  >
                    <img src={wheelImg} alt="" className="h-7 w-7" draggable={false} />
                    {claiming ? t('checkin.claiming')
                      : canUpgrade ? t('checkin.claimEnhanced')
                      : status.todayClaimed ? t('checkin.claimed')
                      : t('checkin.ctaCheckin')}
                  </button>
                )}

                {!result && (
                  <p className="mt-3 text-center text-[12px] text-purple-200/60">{t('checkin.comeBackTomorrow')}</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
