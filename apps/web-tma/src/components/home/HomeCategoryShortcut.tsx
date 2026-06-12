import type { Category } from '@/data/categories'

interface Props {
  category: Category
  onClick: () => void
}

export default function HomeCategoryShortcut({ category, onClick }: Props) {
  return (
    <button type="button" className="flex-shrink-0" onClick={onClick}>
      <div
        className={`flex h-[52px] w-[100px] items-center justify-center rounded-2xl bg-gradient-to-br ${category.color}`}
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <span className="text-[32px] leading-none">{category.icon}</span>
      </div>
    </button>
  )
}
