import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

interface Props {
  amount: number
  onClaim: () => void
  onDismiss: () => void
}

/** 首席体验官进站欢迎弹窗：底部弹出，引导去领取免费礼金（领取走绑定手机号流程）。 */
export default function TrialWelcomeSheet({ amount, onClaim, onDismiss }: Props) {
  const { t } = useTranslation()
  const vars = { amount }

  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/75" onClick={onDismiss} />
      <div className="relative z-10 w-full max-w-[430px] rounded-t-3xl border-t border-amber-300/10 bg-gradient-to-b from-[#1b2740] to-[#07111f] p-6 pb-10 text-center">
        <p className="mb-2 text-4xl">🎖️</p>
        <h3 className="text-xl font-black text-white">{t('bonuses.promos.trial.title')}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{t('bonuses.promos.trial.sheetSub', vars)}</p>
        <p className="mt-3 text-3xl font-black text-primary">₱ {amount}</p>
        <button
          type="button"
          className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-black text-black"
          onClick={onClaim}
        >
          {t('bonuses.promos.trial.sheetCta', vars)}
        </button>
        <button
          type="button"
          className="mt-3 w-full py-2 text-xs font-semibold text-white/50"
          onClick={onDismiss}
        >
          {t('bonuses.promos.trial.sheetLater')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
