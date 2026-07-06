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
    <div className="rounded-2xl bg-white/6 border border-white/10 px-4 py-3.5 text-center">
      <p className="text-sm font-black leading-snug text-primary">
        <span className="mr-1">{icon}</span>{title}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/70">{desc}</p>
      {done ? (
        <div className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-4 py-1.5 text-xs font-black text-emerald-300">
          <Check size={13} strokeWidth={3} />{doneLabel}
        </div>
      ) : (
        <button
          type="button"
          className={`mt-2.5 w-full rounded-xl bg-primary py-2.5 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/25 transition-colors hover:bg-yellow-400 active:scale-[0.98] ${ctaDisabled ? 'opacity-60 pointer-events-none' : ''}`}
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
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-t-3xl bg-gradient-to-b from-[#4a0e82] via-[#2b1259] to-[#141B2D]">
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
            <p className="mt-0.5 font-display text-[2.6rem] font-black leading-none text-primary drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">
              {php(summary.totalShowcase)}
            </p>
            <span className="mt-2 inline-block rounded-full bg-primary px-5 py-1.5 text-sm font-black uppercase tracking-widest text-primary-foreground shadow-lg shadow-amber-500/25">
              {t('bonuses.newPlayer.freeGifts')}
            </span>
          </div>

          <div className="mx-auto mt-5 w-fit rounded-xl bg-black/25 px-6 py-1.5 text-base font-black uppercase tracking-wider text-primary ring-1 ring-primary/40">
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
