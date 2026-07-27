import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

interface Props {
  /** 首充示例档位（有奖励的最低档），无配置时为 null */
  firstDepTier: { depositAmount: number; bonusAmount: number } | null
  firstDepMaxBonus: number
  onDeposit: () => void
  onDismiss: () => void
}

/** 破产承接弹窗：未充值用户把彩金输光（余额归零）时弹出，用首充加码承接「想继续玩」的动机。 */
export default function BustRescueSheet({ firstDepTier, firstDepMaxBonus, onDeposit, onDismiss }: Props) {
  const { t } = useTranslation()

  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/75" onClick={onDismiss} />
      <div className="relative z-10 w-full max-w-[430px] rounded-t-3xl bg-gradient-to-b from-[#4a0e82] to-[#141B2D] p-6 pb-10 text-center">
        <p className="mb-2 text-4xl">🔥</p>
        <h3 className="text-xl font-black text-white">{t('bonuses.bustRescue.title')}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{t('bonuses.bustRescue.subtitle', { max: firstDepMaxBonus })}</p>
        {firstDepTier && (
          <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
            <p className="text-lg font-black text-amber-300">
              {t('bonuses.bustRescue.offerLine', {
                dep: firstDepTier.depositAmount,
                total: firstDepTier.depositAmount + firstDepTier.bonusAmount,
              })}
            </p>
            <p className="mt-1 text-xs text-white/70">{t('bonuses.bustRescue.offerHint', { max: firstDepMaxBonus })}</p>
          </div>
        )}
        <button
          type="button"
          className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
          onClick={onDeposit}
        >
          {t('bonuses.bustRescue.cta')}
        </button>
        <button
          type="button"
          className="mt-3 w-full py-2 text-xs font-semibold text-white/50"
          onClick={onDismiss}
        >
          {t('bonuses.bustRescue.later')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
