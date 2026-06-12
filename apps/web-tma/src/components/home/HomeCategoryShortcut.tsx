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
        className={`flex h-[52px] w-[100px] items-center justify-center rounded-2xl bg-gradient-to-br ${category.color}`}
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <span className="text-[32px] leading-none">{category.icon}</span>
      </div>
      <span className="text-[11px] font-bold text-foreground/80">{t(`category.${category.id}`)}</span>
    </button>
  )
}
