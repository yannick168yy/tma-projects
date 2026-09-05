import type { ReactNode } from 'react'
import GameCardV2 from '@/components/home/GameCardV2'
import type { SlotGame } from '@/api/slots'

/**
 * 首页区块的三个基础排版件（P3-1）。
 *
 * 从 HomeContent 里搬出来做成纯函数组件：区块要能单独成文件（L3 overlay 覆盖单块用），
 * 而闭包在 HomeContent 里的 bigGrid / smallRow 拖着 gamesLoading 与 onTap 一起走，
 * 区块拆出去就带不动。
 */
export function SectionHeader({ icon, title, viewAllLabel, onViewAll }: {
  icon: ReactNode
  title: string
  viewAllLabel: string
  onViewAll?: () => void
}) {
  return (
    <div className="flex items-center justify-between px-4 mb-3">
      <div className="flex items-center gap-2">{icon}<h3 className="text-foreground font-black text-sm font-display">{title}</h3></div>
      {onViewAll && (
        <button type="button"
          className="h-6 px-2 flex items-center rounded-full bg-secondary text-primary text-[10px] font-bold active:scale-90 transition-transform"
          onClick={onViewAll}>{viewAllLabel}</button>
      )}
    </div>
  )
}

/** 大卡：3 列固定网格 */
export function BigGrid({ games, skeletonCount, loading, showHot = false, onTap }: {
  games: SlotGame[]
  skeletonCount: number
  loading: boolean
  showHot?: boolean
  onTap: (uuid: string) => void
}) {
  if (loading) {
    return (
      <div className="px-4 grid grid-cols-3 gap-x-2 gap-y-3">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-xl bg-secondary" />
        ))}
      </div>
    )
  }
  return (
    <div className="px-4 grid grid-cols-3 gap-x-2 gap-y-3">
      {games.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => onTap(g.uuid)} size="lg" showHot={showHot} />)}
    </div>
  )
}

/** 小卡：单行横滑 */
export function SmallRow({ games, loading, onTap }: {
  games: SlotGame[]
  loading: boolean
  onTap: (uuid: string) => void
}) {
  if (loading) {
    return (
      <div className="flex gap-2 px-4 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-[76px] h-[76px] animate-pulse rounded-xl bg-secondary" />
        ))}
      </div>
    )
  }
  return (
    <div className="flex gap-2 px-4 overflow-x-auto hide-scrollbar">
      {games.map((g) => <GameCardV2 key={g.uuid} game={g} onTap={() => onTap(g.uuid)} size="sm" />)}
    </div>
  )
}
