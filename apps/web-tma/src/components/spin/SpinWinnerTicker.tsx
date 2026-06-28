import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpinRecord } from '@/api/spin'

const VISIBLE_ROWS = 8

interface Props {
  records: SpinRecord[]
}

function fmtPhp(amount: number): string {
  if (amount >= 1000) return `₱${Math.round(amount).toLocaleString('en-PH')}`
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

export default function SpinWinnerTicker({ records }: Props) {
  const { t } = useTranslation()
  const loopItems = useMemo(() => {
    if (!records.length) return []
    return [...records, ...records]
  }, [records])

  const durationSec = Math.max(56, records.length * 4.8)

  if (!records.length) {
    return (
      <section className="spin-ticker flex-shrink-0 border-t-4 border-[#ff553d] bg-[#fff0e9] text-[#0b4c2d]">
        <p className="flex h-[calc(var(--spin-ticker-row)*8)] items-center justify-center px-5 text-sm font-normal text-[#0b4c2d]/55">
          {t('spin.noRecords')}
        </p>
      </section>
    )
  }

  return (
    <section className="spin-ticker flex-shrink-0 border-t-4 border-[#ff553d] bg-[#fff0e9] text-[#0b4c2d]">
      <div className="spin-ticker-viewport">
        <div
          className="spin-ticker-track"
          style={{ animationDuration: `${durationSec}s` }}
        >
          {loopItems.map((rec, idx) => (
            <div
              key={`${rec.id}-${idx}`}
              className={`spin-ticker-row grid grid-cols-[1fr_1.35fr_0.9fr] items-center gap-2 px-4 font-normal ${idx % 2 ? 'bg-[#ece3ff]' : 'bg-[#fff0e9]'}`}
            >
              <span className="truncate text-[clamp(0.82rem,3.4vw,1.05rem)]">{rec.displayName}</span>
              <span className="truncate text-center text-[clamp(0.82rem,3.4vw,1.05rem)] text-[#ff553d]">
                {t('common.won')} {fmtPhp(rec.amountPhp)}
              </span>
              <span className="text-right text-[clamp(0.82rem,3.4vw,1.05rem)]">{fmtDate(rec.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export { VISIBLE_ROWS as SPIN_TICKER_VISIBLE_ROWS }
