import type { TaskInitialPath } from '@/hooks/useFullPageOverlay'
import type { FullPageView } from '@/hooks/useFullPageOverlay'

export type TabId = 'casino' | 'games' | 'bonuses' | 'menu'

export const TAB_PATHS: Record<TabId, string> = {
  casino: '/home',
  games: '/games',
  bonuses: '/bonuses',
  menu: '/menu',
}

const PATH_TO_TAB: Record<string, TabId> = {
  '/home': 'casino',
  '/games': 'games',
  '/bonuses': 'bonuses',
  '/menu': 'menu',
}

const OVERLAY_PATHS: Record<string, FullPageView['type']> = {
  '/perya': 'perya',
  '/search': 'search',
  '/team': 'teamCenter',
  '/agent': 'agentCenter',
  '/bet-history': 'betHistory',
  '/rewards': 'ledgerRecords',
  '/referral': 'teamCenter',
  '/rebate': 'rebate',
  '/vip': 'vipCenter',
  '/cashback': 'rebate',
  '/rewards-spin': 'spin',
  '/kyc-setting': 'kycSetting',
  '/download': 'download',
  '/tasks': 'tasks',
}

// games 页筛选状态放 URL：/games?cat=slot&provider=PGSoft，首页/外链可深链到指定分类+厂商
export interface GamesFilter { cat: string; provider: string }

export type ParsedAppRoute =
  | { kind: 'tab'; tab: TabId; promoFilter: string | null; gamesFilter: GamesFilter | null }
  | { kind: 'overlay'; overlay: FullPageView }

// 旧分类大厅(SlotsLobby)的 sortCategory/siteCategory → games 页分类 id
const LEGACY_LOBBY_CAT: Record<string, string> = {
  slots: 'slot', slot: 'slot', live: 'casino', casino: 'casino', table: 'casino',
  perya: 'perya', bingo: 'perya', pinoy: 'perya', crash: 'perya',
  poker: 'poker', fishing: 'fishing', sports: 'sports',
  lottery: 'lottery', other: 'other',
}

/** 旧大厅入参(运营位按钮/历史深链)映射成 games 页分类，认不出的归 all */
export function legacyLobbyCat(value?: string | null): string {
  return (value && LEGACY_LOBBY_CAT[value]) ?? 'all'
}

export function parseAppRoute(pathname: string, search: string): ParsedAppRoute | null {
  if (pathname === '/') return { kind: 'tab', tab: 'casino', promoFilter: null, gamesFilter: null }

  const tab = PATH_TO_TAB[pathname]
  if (tab) {
    const params = new URLSearchParams(search)
    const promoFilter = tab === 'bonuses' ? params.get('promo') : null
    const gamesFilter = tab === 'games'
      ? { cat: params.get('cat') ?? 'all', provider: params.get('provider') ?? 'all' }
      : null
    return { kind: 'tab', tab, promoFilter, gamesFilter }
  }

  // 旧分类大厅已退役：/slots、/slots/<slug> 老链接映射到 games 页对应分类
  if (pathname === '/slots' || pathname.startsWith('/slots/')) {
    const params = new URLSearchParams(search)
    const slug = pathname.startsWith('/slots/') ? decodeURIComponent(pathname.slice('/slots/'.length)) : 'slots'
    const cat = legacyLobbyCat(params.get('siteCategory') ?? slug)
    return { kind: 'tab', tab: 'games', promoFilter: null, gamesFilter: { cat, provider: params.get('provider') ?? 'all' } }
  }

  const overlayType = OVERLAY_PATHS[pathname]
  if (overlayType === 'perya') return { kind: 'overlay', overlay: { type: 'perya' } }
  if (overlayType === 'search') return { kind: 'overlay', overlay: { type: 'search' } }
  if (overlayType === 'teamCenter') return { kind: 'overlay', overlay: { type: 'teamCenter' } }
  if (overlayType === 'agentCenter') return { kind: 'overlay', overlay: { type: 'agentCenter' } }
  if (overlayType === 'betHistory') return { kind: 'overlay', overlay: { type: 'betHistory' } }
  if (overlayType === 'ledgerRecords') return { kind: 'overlay', overlay: { type: 'ledgerRecords' } }
  if (overlayType === 'rebate') return { kind: 'overlay', overlay: { type: 'rebate' } }
  if (overlayType === 'vipCenter') {
    const params = new URLSearchParams(search)
    const rawTab = params.get('tab')
    const initialTab = rawTab === 'cashback' || rawTab === 'benefits' || rawTab === 'records' || rawTab === 'overview'
      ? rawTab
      : undefined
    return { kind: 'overlay', overlay: { type: 'vipCenter', initialTab } }
  }
  if (overlayType === 'spin') return { kind: 'overlay', overlay: { type: 'spin' } }
  if (overlayType === 'kycSetting') return { kind: 'overlay', overlay: { type: 'kycSetting' } }
  if (overlayType === 'download') return { kind: 'overlay', overlay: { type: 'download' } }
  if (overlayType === 'tasks') {
    const rawTab = new URLSearchParams(search).get('tab')
    const initialPath: TaskInitialPath | undefined = rawTab === 'newbie' || rawTab === 'daily' || rawTab === 'social' ? rawTab : undefined
    return { kind: 'overlay', overlay: { type: 'tasks', initialPath } }
  }

  return null
}

export function buildGamesPath(filter?: Partial<GamesFilter>): string {
  const q = new URLSearchParams()
  if (filter?.cat && filter.cat !== 'all') q.set('cat', filter.cat)
  if (filter?.provider && filter.provider !== 'all') q.set('provider', filter.provider)
  const qs = q.toString()
  return `/games${qs ? `?${qs}` : ''}`
}

export function buildTabPath(tab: TabId, promoFilter: string | null = null): string {
  if (tab === 'bonuses' && promoFilter) {
    return `${TAB_PATHS.bonuses}?promo=${encodeURIComponent(promoFilter)}`
  }
  return TAB_PATHS[tab]
}

// 把首页装修配置的 action 统一解析成"导航目标"：内部路由 path 或外部 url（空串=不跳转）。
// 旧类型(promo/cashback/spin/lobby)做向后兼容映射。
export function resolveHomeActionPath(actionType: string, actionValue: string | null): string {
  switch (actionType) {
    case 'path':
    case 'url':
      return actionValue ?? ''
    case 'promo':
      return actionValue ? buildTabPath('bonuses', actionValue) : TAB_PATHS.bonuses
    case 'cashback':
      return '/rebate'
    case 'spin':
      return '/rewards-spin'
    case 'lobby':
      return '/games'
    default:
      return ''
  }
}

/** pushed=应用内压栈打开（关闭时 navigate(-1) 精确回退）；returnTo 仅作深链/兜底 */
export type OverlayNavigateState = { returnTo?: string; pushed?: boolean }

export function currentReturnTo(pathname: string, search: string): string {
  return pathname + search
}
