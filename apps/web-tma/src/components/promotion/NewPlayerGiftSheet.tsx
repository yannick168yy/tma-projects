import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { X, Check } from 'lucide-react'
import type { NewPlayerSummary } from '@/api/promotion'

interface Props {
  summary: NewPlayerSummary
  loggedIn: boolean
  inApp: boolean
  inTelegram: boolean
  trialClaiming: boolean
  appdlClaiming: boolean
  onClose: () => void
  onSignUp: () => void
  onClaimTrial: () => void
  onAppdlAction: () => void
  onOpenDeposit: () => void
  onOpenCashback: () => void
}

function php(n: number) {
  return '₱' + n.toLocaleString('en-PH')
}

interface TaskCardProps {
  icon: string
  title: string
  desc: string
  done: boolean
  doneLabel: string
  cta: string
  ctaDisabled?: boolean
  onCta: () => void
}

function TaskCard({ icon, title, desc, done, doneLabel, cta, ctaDisabled, onCta }: TaskCardProps) {
  return (
    <div className="rounded-2xl bg-[#a50f0f] border border-[#ffd54a]/40 px-4 py-3.5 text-center shadow-[inset_0_2px_8px_rgba(0,0,0,0.25)]">
      <p className="text-sm font-black leading-snug text-[#ffe066]">
        <span className="mr-1">{icon}</span>{title}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/85">{desc}</p>
      {done ? (
        <div className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-4 py-1.5 text-xs font-black text-emerald-300">
          <Check size={13} strokeWidth={3} />{doneLabel}
        </div>
      ) : (
        <button
          type="button"
          className={`mt-2.5 w-full rounded-xl bg-gradient-to-b from-[#ffe066] to-[#f5b40a] py-2.5 text-sm font-black text-[#7a1010] shadow-lg shadow-black/30 active:scale-[0.98] transition-transform ${ctaDisabled ? 'opacity-60 pointer-events-none' : ''}`}
          onClick={onCta}
        >
          {cta}
        </button>
      )}
    </div>
  )
}

export default function NewPlayerGiftSheet({
  summary, loggedIn, inApp, inTelegram, trialClaiming, appdlClaiming,
  onClose, onSignUp, onClaimTrial, onAppdlAction, onOpenDeposit, onOpenCashback,
}: Props) {
  const { t } = useTranslation()
  const { trial, appdl, firstdep } = summary.tasks
  const cashback = summary.cashback
  const showAppdl = appdl.enabled && !inTelegram

  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-t-3xl bg-gradient-to-b from-[#c81414] via-[#8f0d0d] to-[#5c0808]">
        <button
          type="button"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white/90 active:scale-95"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={17} strokeWidth={3} />
        </button>

        <div className="overflow-y-auto overscroll-contain px-4 pb-8 pt-7">
          {/* 大数字锚定区 */}
          <div className="text-center">
            <p className="font-display text-2xl font-black uppercase italic tracking-wide text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
              {t('bonuses.newPlayer.title')}
            </p>
            <p className="mt-0.5 font-display text-[2.6rem] font-black leading-none text-[#ffe066] drop-shadow-[0_3px_0_rgba(122,16,16,0.9)]">
              {php(summary.totalShowcase)}
            </p>
            <span className="mt-2 inline-block rounded-full bg-gradient-to-b from-[#ffe066] to-[#f5a80a] px-5 py-1.5 text-sm font-black uppercase tracking-widest text-[#7a1010] shadow-lg shadow-black/30">
              {t('bonuses.newPlayer.freeGifts')}
            </span>
          </div>

          <div className="mx-auto mt-5 w-fit rounded-xl bg-[#7a0e0e] px-6 py-1.5 text-base font-black uppercase tracking-wider text-[#ffe066] ring-2 ring-[#ffd54a]/60">
            {t('bonuses.newPlayer.howItWorks')}
          </div>

          <div className="mt-4 space-y-3">
            {trial.enabled && (
              <TaskCard
                icon="🎖️"
                title={t('bonuses.newPlayer.trialTitle', { amount: trial.amount })}
                desc={t('bonuses.newPlayer.trialDesc')}
                done={trial.claimed}
                doneLabel={t('bonuses.newPlayer.done')}
                cta={loggedIn
                  ? (trialClaiming ? t('bonuses.promos.trial.claiming') : t('bonuses.newPlayer.ctaClaim', { amount: trial.amount }))
                  : t('bonuses.newPlayer.ctaSignUp')}
                ctaDisabled={trialClaiming}
                onCta={loggedIn ? onClaimTrial : onSignUp}
              />
            )}

            {showAppdl && (
              <TaskCard
                icon="📲"
                title={t('bonuses.newPlayer.appdlTitle', { amount: appdl.amount })}
                desc={t('bonuses.newPlayer.appdlDesc')}
                done={appdl.claimed}
                doneLabel={t('bonuses.newPlayer.done')}
                cta={inApp
                  ? (appdlClaiming ? t('bonuses.promos.appdl.claiming') : t('bonuses.newPlayer.ctaClaim', { amount: appdl.amount }))
                  : t('bonuses.newPlayer.ctaInstall')}
                ctaDisabled={appdlClaiming}
                onCta={onAppdlAction}
              />
            )}

            {firstdep.enabled && (
              <TaskCard
                icon="💰"
                title={t('bonuses.newPlayer.firstdepTitle', { amount: firstdep.maxBonus.toLocaleString('en-PH') })}
                desc={t('bonuses.newPlayer.firstdepDesc')}
                done={firstdep.done}
                doneLabel={t('bonuses.newPlayer.done')}
                cta={t('bonuses.newPlayer.ctaReveal')}
                onCta={onOpenDeposit}
              />
            )}

            {(cashback.monthlyCap > 0 || cashback.topRatePct > 0) && (
              <TaskCard
                icon="💸"
                title={cashback.monthlyCap > 0
                  ? t('bonuses.newPlayer.cashbackCapped', { amount: cashback.monthlyCap.toLocaleString('en-PH') })
                  : t('bonuses.newPlayer.cashbackUnlimited', { rate: cashback.topRatePct })}
                desc={t('bonuses.newPlayer.cashbackDesc')}
                done={false}
                doneLabel=""
                cta={t('bonuses.newPlayer.ctaCashback')}
                onCta={onOpenCashback}
              />
            )}
          </div>

          <p className="mt-4 text-center text-[10px] leading-relaxed text-white/55">
            {t('bonuses.newPlayer.footnote')}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
