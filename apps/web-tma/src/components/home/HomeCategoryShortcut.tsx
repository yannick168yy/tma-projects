import { useTranslation } from 'react-i18next'
import type { Category } from '@/data/categories'

interface Props {
  category: Category
  onClick: () => void
}

export default function HomeCategoryShortcut({ category, onClick }: Props) {
  const { t } = useTranslation()
  const label = t(`category.${category.id}`).toUpperCase()

  return (
    <button type="button" className="flex-shrink-0 active:scale-[0.98] transition-transform" onClick={onClick}>
      <div
        className={`relative h-[60px] w-[111px] overflow-hidden rounded-xl bg-gradient-to-br ${category.color}`}
        style={{ boxShadow: '0 6px 14px rgba(0,0,0,0.14)' }}
      >
        <span className="pointer-events-none absolute -right-2 -top-4 h-14 w-14 rounded-xl border-4 border-white/10 rotate-45" />
        <span className="pointer-events-none absolute right-7 top-4 h-7 w-7 rounded-lg border-[3px] border-white/10 rotate-45" />
        <img src={category.image} alt="" draggable={false} className="absolute -right-7 inset-y-0 h-full w-[62%] object-cover object-center mix-blend-screen opacity-95" />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/5 via-transparent to-white/5" />
        <span className="absolute left-1.5 top-2 max-w-[66px] text-left">
          <span className="block whitespace-nowrap font-display text-[1.05rem] font-black leading-none text-white drop-shadow-sm">{category.offer}</span>
          <span className="mt-1 block text-[0.52rem] font-black uppercase leading-[0.98] text-white drop-shadow-sm">{label}</span>
        </span>
      </div>
    </button>
  )
}
