import { useTranslation } from 'react-i18next'
import type { Category } from '@/data/categories'

interface Props {
  category: Category
  onClick: () => void
}

export default function HomeCategoryShortcut({ category, onClick }: Props) {
  const { t } = useTranslation()

  return (
    <button type="button" className="flex-shrink-0 flex flex-col items-center gap-1.5" onClick={onClick}>
      <div
        className={`relative flex h-[52px] w-[100px] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br ${category.color}`}
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <img src={category.image} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        <span className="pointer-events-none absolute inset-0 bg-black/10" />
      </div>
      <span className="text-[11px] font-bold text-foreground/80">{t(`category.${category.id}`)}</span>
    </button>
  )
}
