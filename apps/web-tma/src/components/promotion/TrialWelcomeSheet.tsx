import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { usePromotionStore } from '@/stores/promotion'

interface Props {
  amount: number
  currency: string
  /** 首充示例档位（取有奖励的最低档），无档位配置时为 null */
  firstDepTier: { depositAmount: number; bonusAmount: number } | null
  /** 首充最高可得礼金 */
  firstDepMaxBonus: number
  onClaimed: () => void
  onDeposit: () => void
  onDismiss: () => void
}

/** 首席体验官进站欢迎弹窗：一键领取免费礼金（免绑定），领取成功后原地引导首充加码。 */
export default function TrialWelcomeSheet({ amount, currency, firstDepTier, firstDepMaxBonus, onClaimed, onDeposit, onDismiss }: Props) {
  const { t } = useTranslation()
  const claimTrialIfEligible = usePromotionStore((s) => s.claimTrialIfEligible)
  const [step, setStep] = useState<'offer' | 'claimed'>('offer')
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const showFirstDep = firstDepMaxBonus > 0

  async function onClaim() {
    if (claiming) return
    setClaiming(true)
    setError(null)
    const result = await claimTrialIfEligible({ silent: true })
    setClaiming(false)
    if (result.ok) {
      setStep('claimed')
      onClaimed()
      return
    }
    if (result.alreadyClaimed) {
      onDismiss()
      return
    }
    setError(result.message ?? t('bonuses.promos.trial.claimFailed'))
  }

  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/75" onClick={onDismiss} />
      <div className="relative z-10 w-full max-w-[430px] rounded-t-3xl bg-gradient-to-b from-[#4a0e82] to-[#141B2D] p-6 pb-10 text-center">
        {step === 'offer' ? (
          <>
            <p className="mb-2 text-4xl">🎖️</p>
            <h3 className="text-xl font-black text-white">{t('bonuses.promos.trial.title')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{t('bonuses.promos.trial.sheetSub', { amount })}</p>
            <p className="mt-3 text-3xl font-black text-primary">{currency === 'IDR' ? `Rp ${amount.toLocaleString('en-US')}` : currency === 'PHP' ? `₱ ${amount.toLocaleString('en-PH')}` : `${amount.toLocaleString('en-US')} ${currency}`}</p>
            {showFirstDep && (
              <p className="mt-2 text-xs font-semibold text-amber-300/90">{t('bonuses.promos.trial.firstdepTeaser', { max: firstDepMaxBonus })}</p>
            )}
            <button
              type="button"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground disabled:opacity-60"
              disabled={claiming}
              onClick={() => void onClaim()}
            >
              {claiming && <Loader2 size={16} className="animate-spin" />}
              {claiming ? t('bonuses.promos.trial.claiming') : t('bonuses.promos.trial.sheetCta', { amount })}
            </button>
            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            <button
              type="button"
              className="mt-3 w-full py-2 text-xs font-semibold text-white/50"
              onClick={onDismiss}
            >
              {t('bonuses.promos.trial.sheetLater')}
            </button>
          </>
        ) : (
          <>
            <p className="mb-2 text-4xl">🎉</p>
            <h3 className="text-xl font-black text-white">{t('bonuses.promos.trial.claimedTitle', { amount })}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{t('bonuses.promos.trial.claimedSub')}</p>
            {showFirstDep && (
              <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
                <p className="text-sm font-black text-amber-300">{t('bonuses.promos.trial.firstdepOfferTitle', { max: firstDepMaxBonus })}</p>
                {firstDepTier && (
                  <p className="mt-1 text-xs text-white/70">
                    {t('bonuses.promos.trial.firstdepOfferLine', {
                      dep: firstDepTier.depositAmount,
                      total: firstDepTier.depositAmount + firstDepTier.bonusAmount,
                    })}
                  </p>
                )}
              </div>
            )}
            {showFirstDep ? (
              <>
                <button
                  type="button"
                  className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
                  onClick={onDeposit}
                >
                  {t('bonuses.promos.trial.goDeposit')}
                </button>
                <button
                  type="button"
                  className="mt-3 w-full py-2 text-xs font-semibold text-white/50"
                  onClick={onDismiss}
                >
                  {t('bonuses.promos.trial.playFirst')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
                onClick={onDismiss}
              >
                {t('bonuses.promos.trial.playFirst')}
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
