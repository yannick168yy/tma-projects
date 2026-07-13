import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Clock } from 'lucide-react'
import { formatCurrencyAmount } from '@/stores/wallet'

interface Props {
  minDeposit: number
  bonusAmount: number
  endsAt: string
  currency?: string
  onDeposit: () => void
  onDismiss: () => void
}

/** 复充限时优惠进站弹窗：倒计时 + 引导充值（窗口内充值达标自动发奖励）。 */
export default function RedepOfferSheet({ minDeposit, bonusAmount, endsAt, currency = 'PHP', onDeposit, onDismiss }: Props) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  const endsMs = new Date(endsAt).getTime()

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (endsMs <= now) onDismiss()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsMs <= now])

  const s = Math.max(0, Math.floor((endsMs - now) / 1000))
  const p = (n: number) => String(n).padStart(2, '0')
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  const countdown = hh > 0 ? `${p(hh)}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`
  const vars = { min: formatCurrencyAmount(currency, minDeposit), bonus: formatCurrencyAmount(currency, bonusAmount) }

  return createPortal(
    <div className="fixed inset-0 z-[94] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/75" onClick={onDismiss} />
      <div className="relative z-10 w-full max-w-[430px] rounded-t-3xl bg-gradient-to-b from-[#7a3a05] to-[#141B2D] p-6 pb-10 text-center">
        <p className="mb-2 text-4xl">⏰</p>
        <h3 className="text-xl font-black text-white">{t('wallet.limitedOfferTitle')}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{t('wallet.limitedOfferDesc', vars)}</p>
        <p className="mt-3 text-3xl font-black text-primary">+{formatCurrencyAmount(currency, bonusAmount)}</p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-400/15 px-4 py-2 text-amber-300">
          <Clock size={16} />
          <span className="font-mono text-lg font-black tabular-nums">{countdown}</span>
        </div>
        <button
          type="button"
          className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
          onClick={onDeposit}
        >
          {t('wallet.limitedOfferCta')}
        </button>
        <button
          type="button"
          className="mt-3 w-full py-2 text-xs font-semibold text-white/50"
          onClick={onDismiss}
        >
          {t('wallet.limitedOfferLater')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
