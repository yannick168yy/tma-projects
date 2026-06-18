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
        className={`relative h-[120px] w-[222px] overflow-hidden rounded-xl bg-gradient-to-br ${category.color}`}
        style={{ boxShadow: '0 10px 24px rgba(0,0,0,0.18)' }}
      >
        <span className="pointer-events-none absolute -right-4 -top-8 h-28 w-28 rounded-[24px] border-[8px] border-white/10 rotate-45" />
        <span className="pointer-events-none absolute right-14 top-8 h-14 w-14 rounded-[16px] border-[7px] border-white/10 rotate-45" />
        <img src={category.image} alt="" draggable={false} className="absolute -right-14 inset-y-0 h-full w-[62%] object-cover object-center mix-blend-screen opacity-95" />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/5 via-transparent to-white/5" />
        <span className="absolute left-3 top-4 max-w-[132px] text-left">
          <span className="block whitespace-nowrap font-display text-[2.15rem] font-black leading-none text-white drop-shadow-sm">{category.offer}</span>
          <span className="mt-2 block text-[0.95rem] font-black uppercase leading-[0.98] text-white drop-shadow-sm">{label}</span>
        </span>
      </div>
    </button>
  )
}
