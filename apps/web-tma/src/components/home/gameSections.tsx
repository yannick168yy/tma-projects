import type { ReactNode } from 'react'
import {
  Drama, Fish, Gamepad2, Gem, Percent, Rocket, Sparkles, Ticket, TrendingUp, Trophy,
} from 'lucide-react'
import type { HomeSection, SlotGame } from '@/api/slots'
import { BigGrid, SectionHeader, SmallRow } from './primitives'

/**
 * 游戏区块注册表（P3-1）。
 *
 * 这 11 个块原来是 11 段几乎一样的 JSX：图标 + 标题 + 「查看全部」+ 网格。
 * 差异只有图标/文案/跳转/默认卡型这四项，所以改成一张表 —— 加一个游戏专区
 * 从「照抄一段 JSX」变成「加一行」，也就不会再出现某块忘了跟上改动的情况。
 *
 * `dataKey` 指向 /slots/homepage 下发的选品字段；`recommendedDisplay` 是唯一例外，
 * 它要先剔除「最近在玩」已展示的游戏，算好后由调用方传进来。
 */
export type GameDataKey =
  | 'popular' | 'highRebate' | 'highRtp' | 'recommendedDisplay' | 'slots' | 'casino'
  | 'newGames' | 'perya' | 'fishing' | 'lottery' | 'baccarat' | 'sports'

export interface GameSectionSpec {
  key: string
  dataKey: GameDataKey
  icon: ReactNode
  /** i18n key */
  titleKey: string
  /** 「查看全部」跳转路径；不填则不显示该按钮 */
  navPath?: string
  layout: 'big' | 'small'
  /** 骨架屏格数：与该块常见条数一致，跳动最小 */
  skeleton: number
  showHot?: boolean
  /** 硬上限：后台没配 limit 时也不超过这个数 */
  cap?: number
  /** 上间距，默认 mt-6。popular 紧跟在轮播/最近在玩下面，用 mt-5 */
  marginTop?: string
  /** 加载中不占位（少数块原本就是「有数据才出现」，占位会让首屏多闪一下） */
  hideWhileLoading?: boolean
}

export const GAME_SECTIONS: GameSectionSpec[] = [
  { key: 'popular', dataKey: 'popular', icon: <TrendingUp size={15} className="text-primary" />,
    titleKey: 'home.popularGames', navPath: '/games', layout: 'big', skeleton: 12, showHot: true,
    marginTop: 'mt-5' },
  { key: 'highRebate', dataKey: 'highRebate', icon: <Gem size={15} className="text-amber-400" />,
    titleKey: 'home.highRebate', navPath: '/games?cat=highrebate', layout: 'big', skeleton: 9,
    hideWhileLoading: true },
  { key: 'highRtp', dataKey: 'highRtp', icon: <Rocket size={15} className="text-yellow-400" />,
    titleKey: 'home.highRtp', navPath: '/games?cat=highrtp', layout: 'small', skeleton: 6 },
  { key: 'recommended', dataKey: 'recommendedDisplay', icon: <Percent size={15} className="text-red-400" />,
    titleKey: 'home.recommended', navPath: '/games', layout: 'big', skeleton: 12 },
  { key: 'slots', dataKey: 'slots', icon: <Gamepad2 size={15} className="text-violet-400" />,
    titleKey: 'home.egamesZone', navPath: '/games?cat=slot', layout: 'big', skeleton: 6 },
  { key: 'casino', dataKey: 'casino', icon: <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />,
    titleKey: 'home.casinoZone', navPath: '/games?cat=casino', layout: 'big', skeleton: 6 },
  { key: 'newGames', dataKey: 'newGames', icon: <Sparkles size={15} className="text-emerald-400" />,
    titleKey: 'home.newGames', layout: 'small', skeleton: 6 },
  { key: 'perya', dataKey: 'perya', icon: <Drama size={15} className="text-orange-400" />,
    titleKey: 'home.peryaZone', navPath: '/games?cat=perya', layout: 'big', skeleton: 6 },
  { key: 'fishing', dataKey: 'fishing', icon: <Fish size={15} className="text-cyan-400" />,
    titleKey: 'home.fishingZone', navPath: '/games?cat=fishing', layout: 'big', skeleton: 6 },
  { key: 'lottery', dataKey: 'lottery', icon: <Ticket size={15} className="text-pink-400" />,
    titleKey: 'home.lotteryZone', navPath: '/games?cat=lottery', layout: 'big', skeleton: 6, cap: 6 },
  { key: 'baccarat', dataKey: 'baccarat', icon: <Gem size={15} className="text-purple-400" />,
    titleKey: 'home.baccaratZone', layout: 'small', skeleton: 6 },
  // 体育：USDT 下仅 1 款，空则整块不渲染
  { key: 'sports', dataKey: 'sports', icon: <Trophy size={15} className="text-green-400" />,
    titleKey: 'home.sportsZone', navPath: '/games?cat=sports', layout: 'big', skeleton: 6 },
]

export function GameSectionBlock({ spec, section, games, loading, enabled = true, t, onTap, onNavigate }: {
  spec: GameSectionSpec
  /** 后台下发的该块参数（数量与卡型） */
  section: HomeSection
  games: SlotGame[]
  loading: boolean
  /** 额外的出现条件（如「推荐精选」只在最近在玩占了上方那行时才出现） */
  enabled?: boolean
  t: (key: string) => string
  onTap: (uuid: string) => void
  onNavigate: (path: string) => void
}) {
  if (!enabled) return null
  if (spec.hideWhileLoading ? games.length === 0 : (!loading && games.length === 0)) return null
  const capped = spec.cap ? games.slice(0, spec.cap) : games
  const list = section.limit ? capped.slice(0, section.limit) : capped
  const layout = section.layout ?? spec.layout
  return (
    <section className={spec.marginTop ?? 'mt-6'}>
      <SectionHeader icon={spec.icon} title={t(spec.titleKey)} viewAllLabel={t('common.viewAll')}
        onViewAll={spec.navPath ? () => onNavigate(spec.navPath!) : undefined} />
      {layout === 'big'
        ? <BigGrid games={list} skeletonCount={section.limit ?? spec.skeleton} loading={loading} showHot={spec.showHot} onTap={onTap} />
        : <SmallRow games={list} loading={loading} onTap={onTap} />}
    </section>
  )
}
