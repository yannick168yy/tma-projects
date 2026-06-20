import type { CategoryLobbyParams } from '@/hooks/useFullPageOverlay'
import type { FullPageView } from '@/hooks/useFullPageOverlay'

export type TabId = 'casino' | 'bingo' | 'bonuses' | 'menu'

export const TAB_PATHS: Record<TabId, string> = {
  casino: '/casino',
  bingo: '/bingo',
  bonuses: '/bonuses',
  menu: '/menu',
}

const PATH_TO_TAB: Record<string, TabId> = {
  '/casino': 'casino',
  '/bingo': 'bingo',
  '/bonuses': 'bonuses',
  '/menu': 'menu',
}

const OVERLAY_PATHS: Record<string, FullPageView['type']> = {
  '/search': 'search',
  '/slots': 'slotsLobby',
  '/team': 'teamCenter',
  '/agent': 'agentCenter',
  '/bet-history': 'betHistory',
  '/rewards': 'ledgerRecords',
  '/referral': 'referralPromo',
  '/cashback': 'cashback',
  '/rewards-spin': 'spin',
}

export type ParsedAppRoute =
  | { kind: 'tab'; tab: TabId; promoFilter: string | null }
  | { kind: 'overlay'; overlay: FullPageView }

function parseCategoryLobby(pathname: string, search: URLSearchParams): FullPageView {
  const rawSlug = pathname.slice('/slots/'.length)
  const slug = decodeURIComponent(rawSlug)
  const params: CategoryLobbyParams = {
    title: search.get('title') ? decodeURIComponent(search.get('title')!) : slug,
  }
  if (slug !== 'popular') params.sortCategory = slug
  const sortBy = search.get('sortBy')
  if (sortBy === 'weight' || sortBy === 'ph_bonus') params.sortBy = sortBy
  const themes = search.get('themes')
  if (themes) params.themes = themes.split(',').filter(Boolean)
  const gameStyles = search.get('gameStyles')
  if (gameStyles) params.gameStyles = gameStyles.split(',').filter(Boolean)
  const playerTypes = search.get('playerTypes')
  if (playerTypes) params.playerTypes = playerTypes.split(',').filter(Boolean)
  const gameUuids = search.get('gameUuids')
  if (gameUuids) params.gameUuids = gameUuids.split(',').filter(Boolean)
  return { type: 'categoryLobby', params }
}

export function parseAppRoute(pathname: string, search: string): ParsedAppRoute | null {
  if (pathname === '/') return { kind: 'tab', tab: 'casino', promoFilter: null }

  const tab = PATH_TO_TAB[pathname]
  if (tab) {
    const promoFilter = tab === 'bonuses' ? new URLSearchParams(search).get('promo') : null
    return { kind: 'tab', tab, promoFilter }
  }

  const overlayType = OVERLAY_PATHS[pathname]
  if (overlayType === 'slotsLobby') return { kind: 'overlay', overlay: { type: 'slotsLobby' } }
  if (overlayType === 'search') return { kind: 'overlay', overlay: { type: 'search' } }
  if (overlayType === 'teamCenter') return { kind: 'overlay', overlay: { type: 'teamCenter' } }
  if (overlayType === 'agentCenter') return { kind: 'overlay', overlay: { type: 'agentCenter' } }
  if (overlayType === 'betHistory') return { kind: 'overlay', overlay: { type: 'betHistory' } }
  if (overlayType === 'ledgerRecords') return { kind: 'overlay', overlay: { type: 'ledgerRecords' } }
  if (overlayType === 'referralPromo') return { kind: 'overlay', overlay: { type: 'referralPromo' } }
  if (overlayType === 'cashback') return { kind: 'overlay', overlay: { type: 'cashback' } }
  if (overlayType === 'spin') return { kind: 'overlay', overlay: { type: 'spin' } }

  if (pathname.startsWith('/slots/')) {
    return { kind: 'overlay', overlay: parseCategoryLobby(pathname, new URLSearchParams(search)) }
  }

  return null
}

export function buildCategoryLobbyPath(params: CategoryLobbyParams): string {
  const slug = encodeURIComponent(params.sortCategory ?? 'popular')
  const q = new URLSearchParams()
  if (params.sortBy) q.set('sortBy', params.sortBy)
  if (params.title) q.set('title', params.title)
  if (params.themes?.length) q.set('themes', params.themes.join(','))
  if (params.gameStyles?.length) q.set('gameStyles', params.gameStyles.join(','))
  if (params.playerTypes?.length) q.set('playerTypes', params.playerTypes.join(','))
  if (params.gameUuids?.length) q.set('gameUuids', params.gameUuids.join(','))
  const qs = q.toString()
  return `/slots/${slug}${qs ? `?${qs}` : ''}`
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
      return '/cashback'
    case 'spin':
      return '/rewards-spin'
    case 'lobby':
      return '/slots/popular?sortBy=ph_bonus'
    default:
      return ''
  }
}

export type OverlayNavigateState = { returnTo?: string }

export function currentReturnTo(pathname: string, search: string): string {
  return pathname + search
}
