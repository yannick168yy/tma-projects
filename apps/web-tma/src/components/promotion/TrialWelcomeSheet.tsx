import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

interface Props {
  claiming: boolean
  onClaim: () => void
  onDismiss: () => void
  amount?: number
}

export default function TrialWelcomeSheet({ claiming, onClaim, onDismiss, amount = 88 }: Props) {
  const { t } = useTranslation()
  const vars = { amount }

  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/75" onClick={claiming ? undefined : onDismiss} />
      <div className="relative z-10 w-full max-w-[430px] rounded-t-3xl bg-gradient-to-b from-[#4a0e82] to-[#141B2D] p-6 pb-10 text-center">
        <p className="text-4xl mb-2">🎖️</p>
        <h3 className="text-xl font-black text-white">{t('bonuses.promos.trial.title')}</h3>
        <p className="mt-2 text-sm text-white/60 leading-relaxed">{t('bonuses.promos.trial.sheetSub', vars)}</p>
        <p className="mt-3 text-3xl font-black text-primary">₱ {amount}</p>
        <button
          type="button"
          className={`mt-6 w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground ${claiming ? 'opacity-60 pointer-events-none' : ''}`}
          onClick={onClaim}
        >
          {claiming ? t('bonuses.promos.trial.claiming') : t('bonuses.promos.trial.sheetCta', vars)}
        </button>
        <button
          type="button"
          className="mt-3 w-full py-2 text-xs font-semibold text-white/50"
          disabled={claiming}
          onClick={onDismiss}
        >
          {t('bonuses.promos.trial.sheetLater')}
        </button>
      </div>
    </div>,
    document.body,
  )
}

export const TRIAL_SHEET_SEEN_KEY = 'betogo_trial_sheet_seen'
