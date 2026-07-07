import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Check, Sparkles } from 'lucide-react'
import { fetchCheckinStatus, claimCheckin, type CheckinStatus, type CheckinTier, type CheckinClaimResult } from '@/api/promotion'
import { fetchSpinStatus } from '@/api/spin'
import { ApiError } from '@/api/client'
import { useWalletStore } from '@/stores/wallet'

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

export default function CheckinSheet({ open, onClose, onOpenSpin }: Props) {
  const { t } = useTranslation()
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

  return (
    <div className="fixed inset-0 z-[94] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-t-3xl bg-gradient-to-b from-[#2b1259] via-[#1a1440] to-[#141B2D]">
        <button
          type="button"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white/90 active:scale-95"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="overflow-y-auto px-4 pb-6 pt-6">
          {/* 标题 */}
          <div className="text-center">
            <h2 className="font-display text-2xl font-black text-white">{t('checkin.title')}</h2>
            {status && (
              <p className="mt-1 text-xs text-white/60">
                {t('checkin.subtitle', { streak: status.streak, monthDays: status.monthDays })}
              </p>
            )}
            <p className="mx-auto mt-2 max-w-[280px] text-[11px] leading-snug text-amber-300/90">{t('checkin.rewardIntro')}</p>
          </div>

          {loading && <div className="py-12 text-center text-sm text-white/50">…</div>}

          {!loading && status && status.enabled === false && (
            <p className="py-12 text-center text-sm text-white/60">{t('checkin.disabled')}</p>
          )}

          {!loading && status && status.enabled !== false && (
            <>
              {/* 7 天连签格 */}
              <div className="mt-5 grid grid-cols-7 gap-1.5">
                {status.cycle.map((c) => {
                  const done = c.day < status.cycleDay || (c.day === status.cycleDay && status.todayClaimed)
                  const isToday = c.day === status.cycleDay && !status.todayClaimed
                  const peak = c.day === status.cycle.length
                  return (
                    <div
                      key={c.day}
                      className={`relative flex flex-col items-center gap-1 rounded-xl px-0.5 py-2 ring-1 ${
                        done ? 'bg-primary/20 ring-primary/50'
                        : isToday ? 'bg-white/10 ring-2 ring-primary animate-pulse'
                        : 'bg-white/[0.04] ring-white/10'
                      }`}
                    >
                      <span className="text-[9px] font-bold text-white/50">{t('checkin.dayLabel', { day: c.day })}</span>
                      {done
                        ? <Check size={16} className="text-primary" strokeWidth={3} />
                        : <span className="text-base leading-none">🎡</span>}
                      <span className={`text-[9px] font-black ${peak ? 'text-amber-300' : 'text-white/80'}`}>×{c.base.n}</span>
                      <span className={`text-[7px] font-bold leading-none ${peak ? 'text-amber-300' : 'text-white/45'}`}>{tierLabel(c.base.tier)}</span>
                    </div>
                  )
                })}
              </div>

              {/* 增强轨提示 */}
              <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] ${
                status.enhancedEligibleToday ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-white/60'
              }`}>
                <Sparkles size={14} className="flex-shrink-0" />
                <span>{status.enhancedEligibleToday ? t('checkin.enhancedUnlocked') : t('checkin.enhancedHint')}</span>
              </div>

              {/* 月度里程碑 */}
              <div className="mt-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/50">{t('checkin.milestoneTitle')}</p>
                <div className="flex gap-2">
                  {status.milestones.map((m) => (
                    <div key={m.atDays} className={`flex flex-1 flex-col items-center rounded-xl px-1 py-2 ring-1 ${
                      m.reached ? 'bg-amber-500/15 ring-amber-400/40' : 'bg-white/[0.04] ring-white/10'
                    }`}>
                      <span className={`text-sm font-black ${m.reached ? 'text-amber-300' : 'text-white/70'}`}>{m.atDays}{t('checkin.daysUnit')}</span>
                      <span className={`text-[10px] font-bold ${TIER_TEXT[m.tier]}`}>🎡 {tierLabel(m.tier)}×{m.n}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 常驻转盘入口（复访/已签到态也能触达转盘） */}
              {!result && spinRemaining > 0 && (
                <button
                  type="button"
                  className="mt-4 flex w-full items-center justify-between rounded-2xl bg-gradient-to-r from-primary/25 to-amber-500/20 px-4 py-3 ring-1 ring-primary/40 active:scale-95"
                  onClick={() => { onOpenSpin(); onClose() }}
                >
                  <span className="flex items-center gap-2 text-sm font-black text-white">
                    <span className="text-lg leading-none">🎡</span>
                    {t('checkin.spinEntry', { n: spinRemaining })}
                  </span>
                  <span className="text-sm font-black text-amber-300">{t('checkin.goSpin')}</span>
                </button>
              )}

              {/* 领取结果 / 报错 */}
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

              {/* 签到按钮 */}
              {!result && (
                <button
                  type="button"
                  disabled={claiming || (status.todayClaimed && !status.canUpgradeToday)}
                  className="mt-5 w-full rounded-full bg-primary py-3.5 text-sm font-black text-primary-foreground transition-opacity active:scale-95 disabled:opacity-40"
                  onClick={() => void onClaim()}
                >
                  {claiming ? t('checkin.claiming')
                    : status.todayClaimed
                      ? (status.canUpgradeToday ? t('checkin.claimEnhanced') : t('checkin.claimed'))
                      : t('checkin.claim')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
