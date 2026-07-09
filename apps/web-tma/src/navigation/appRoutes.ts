import type { CategoryLobbyParams } from '@/hooks/useFullPageOverlay'
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
  '/slots': 'slotsLobby',
  '/team': 'teamCenter',
  '/agent': 'agentCenter',
  '/bet-history': 'betHistory',
  '/rewards': 'ledgerRecords',
  '/referral': 'teamCenter',
  '/vip': 'vipCenter',
  '/cashback': 'vipCenter',
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

function parseCategoryLobby(pathname: string, search: URLSearchParams): FullPageView {
  const rawSlug = pathname.slice('/slots/'.length)
  const slug = decodeURIComponent(rawSlug)
  const params: CategoryLobbyParams = {
    title: search.get('title') ? decodeURIComponent(search.get('title')!) : slug,
  }
  if (slug !== 'popular') params.sortCategory = slug
  const siteCategory = search.get('siteCategory')
  if (siteCategory) params.siteCategory = siteCategory
  const provider = search.get('provider')
  if (provider) params.provider = provider
  const sortBy = search.get('sortBy')
  if (sortBy === 'weight') params.sortBy = sortBy
  const gameUuids = search.get('gameUuids')
  if (gameUuids) params.gameUuids = gameUuids.split(',').filter(Boolean)
  return { type: 'categoryLobby', params }
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

  const overlayType = OVERLAY_PATHS[pathname]
  if (overlayType === 'perya') return { kind: 'overlay', overlay: { type: 'perya' } }
  if (overlayType === 'slotsLobby') return { kind: 'overlay', overlay: { type: 'slotsLobby' } }
  if (overlayType === 'search') return { kind: 'overlay', overlay: { type: 'search' } }
  if (overlayType === 'teamCenter') return { kind: 'overlay', overlay: { type: 'teamCenter' } }
  if (overlayType === 'agentCenter') return { kind: 'overlay', overlay: { type: 'agentCenter' } }
  if (overlayType === 'betHistory') return { kind: 'overlay', overlay: { type: 'betHistory' } }
  if (overlayType === 'ledgerRecords') return { kind: 'overlay', overlay: { type: 'ledgerRecords' } }
  if (overlayType === 'vipCenter') {
    const params = new URLSearchParams(search)
    const rawTab = params.get('tab')
    const initialTab = rawTab === 'cashback' || rawTab === 'benefits' || rawTab === 'records' || rawTab === 'overview'
      ? rawTab
      : pathname === '/cashback' ? 'cashback' : undefined
    return { kind: 'overlay', overlay: { type: 'vipCenter', initialTab } }
  }
  if (overlayType === 'spin') return { kind: 'overlay', overlay: { type: 'spin' } }
  if (overlayType === 'kycSetting') return { kind: 'overlay', overlay: { type: 'kycSetting' } }
  if (overlayType === 'download') return { kind: 'overlay', overlay: { type: 'download' } }
  if (overlayType === 'tasks') return { kind: 'overlay', overlay: { type: 'tasks' } }

  if (pathname.startsWith('/slots/')) {
    return { kind: 'overlay', overlay: parseCategoryLobby(pathname, new URLSearchParams(search)) }
  }

  return null
}

export function buildCategoryLobbyPath(params: CategoryLobbyParams): string {
  const slug = encodeURIComponent(params.sortCategory ?? 'popular')
  const q = new URLSearchParams()
  if (params.siteCategory) q.set('siteCategory', params.siteCategory)
  if (params.provider) q.set('provider', params.provider)
  if (params.sortBy) q.set('sortBy', params.sortBy)
  if (params.title) q.set('title', params.title)
  if (params.gameUuids?.length) q.set('gameUuids', params.gameUuids.join(','))
  const qs = q.toString()
  return `/slots/${slug}${qs ? `?${qs}` : ''}`
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
      return '/vip?tab=cashback'
    case 'spin':
      return '/rewards-spin'
    case 'lobby':
      return '/slots/popular?sortBy=weight'
    default:
      return ''
  }
}

export type OverlayNavigateState = { returnTo?: string }

export function currentReturnTo(pathname: string, search: string): string {
  return pathname + search
}
