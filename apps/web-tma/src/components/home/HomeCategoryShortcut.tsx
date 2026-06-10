import { useTranslation } from 'react-i18next'
import { Gift } from 'lucide-react'
import type { Category } from '@/data/categories'

interface Props {
  category: Category
  claimable: boolean
  claimLabel: string | null
  onClick: () => void
}

export default function HomeCategoryShortcut({ category, claimable, claimLabel, onClick }: Props) {
  const { t } = useTranslation()
  const label = t(`category.${category.id}`)

  return (
    <button type="button" className="flex-shrink-0 flex flex-col items-center gap-1.5 pt-2.5" onClick={onClick}>
      <div className="relative overflow-visible">
        {claimable && (
          <div
            className="pointer-events-none absolute -inset-[3px] rounded-[18px] bg-gradient-to-br from-amber-400 via-primary to-amber-500 opacity-90 animate-pulse"
            style={{ boxShadow: '0 0 14px rgba(251, 191, 36, 0.55)' }}
          />
        )}
        {claimLabel && !claimable && (
          <div
            className="absolute left-2 top-[-11px] z-10 flex items-center gap-0.5 whitespace-nowrap bg-red-500 px-[7px] py-1 pl-[5px] text-[11px] font-black text-white"
            style={{ borderRadius: '6px 6px 6px 0', boxShadow: 'var(--shadow-tag)' }}
          >
            🔥 {claimLabel}
            <span className="absolute bottom-[-6px] left-0 h-0 w-0" style={{ borderLeft: '6px solid #ef4444', borderBottom: '6px solid transparent' }} />
          </div>
        )}
        <div
          className={`relative flex h-[59px] w-[110px] flex-col items-center justify-end rounded-2xl bg-gradient-to-br ${category.color}${claimable ? ' ring-2 ring-amber-300/80 ring-inset' : ''}`}
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          <div className="flex w-full flex-1 items-center justify-center">
            <span className="text-[36px] leading-none">{category.icon}</span>
          </div>
        </div>
        {claimable && (
          <div
            className="absolute -right-1 -top-2 z-20 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-500 to-primary px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-black shadow-lg"
            style={{ boxShadow: '0 2px 10px rgba(251, 191, 36, 0.6)' }}
          >
            <Gift size={10} strokeWidth={3} />
            {t('common.claim')}
          </div>
        )}
      </div>
      <span className={`text-[12px] font-bold ${claimable ? 'text-primary' : 'text-foreground/80'}`}>
        {label}
      </span>
    </button>
  )
}
