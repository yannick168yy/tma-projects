import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  amount: number
  currency: string
  onClose: () => void
}

export default function RedPacketSheet({ title, amount, currency, onClose }: Props) {
  const { t } = useTranslation()

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[430px] rounded-t-3xl bg-gradient-to-b from-[#4a0e82] to-[#141B2D] p-6 pb-10 text-center">
        <p className="text-4xl mb-2">🧧</p>
        <h3 className="text-xl font-black text-white">{title}</h3>
        <p className="mt-2 text-3xl font-black text-primary">
          {currency === 'IDR' ? `Rp ${amount.toLocaleString('en-US')}` : currency === 'PHP' ? `₱ ${amount.toLocaleString('en-PH')}` : `${amount.toLocaleString('en-US')} ${currency}`}
        </p>
        <p className="mt-2 text-xs text-white/60">{t('redpacket.credited')}</p>
        <button
          type="button"
          className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
          onClick={onClose}
        >
          {t('redpacket.awesome')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
