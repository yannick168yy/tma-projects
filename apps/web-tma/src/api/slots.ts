import { apiRequest } from './client'

export interface SlotGame {
  uuid: string
  name: string
  nameId: string | null
  nameVi: string | null
  nameZh: string | null
  provider: string
  category: string | null
  subCategory: string | null
  sortCategory: string | null
  imageUrl: string | null
  imageHqUrl: string | null
  hasDemo: boolean
  hasLobby: boolean
  isMobile: boolean
  weight: number
  phBonus: number
  isFeatured: boolean
  theme: string | null
}

export interface GameListResult {
  items: SlotGame[]
  total: number
  page: number
  pages: number
}

export interface GameListParams {
  page?: number
  limit?: number
  search?: string
  provider?: string
  category?: string
  sortCategory?: string
  sortBy?: 'weight' | 'ph_bonus' | 'name'
  themes?: string[]
  gameStyles?: string[]
  playerTypes?: string[]
}

export interface HomepageGames {
  popular: SlotGame[]
  slots: SlotGame[]
  live: SlotGame[]
  fishing: SlotGame[]
  crash: SlotGame[]
  table: SlotGame[]
  generatedAt: string
}

export function fetchHomepageGames(): Promise<HomepageGames> {
  return apiRequest<HomepageGames>('/slots/homepage')
}

export function fetchGames(params: GameListParams = {}): Promise<GameListResult> {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.search) qs.set('search', params.search)
  if (params.provider && params.provider !== 'all') qs.set('provider', params.provider)
  if (params.category && params.category !== 'all') qs.set('category', params.category)
  if (params.sortCategory) qs.set('sortCategory', params.sortCategory)
  if (params.sortBy) qs.set('sortBy', params.sortBy)
  if (params.themes?.length) qs.set('themes', params.themes.join(','))
  if (params.gameStyles?.length) qs.set('gameStyles', params.gameStyles.join(','))
  if (params.playerTypes?.length) qs.set('playerTypes', params.playerTypes.join(','))
  const q = qs.toString()
  return apiRequest<GameListResult>(`/slots/games${q ? `?${q}` : ''}`)
}

export function fetchProviders(sortCategory?: string): Promise<string[]> {
  const qs = sortCategory ? `?sortCategory=${encodeURIComponent(sortCategory)}` : ''
  return apiRequest<string[]>(`/slots/providers${qs}`)
}

export function fetchThemes(): Promise<string[]> {
  return apiRequest<string[]>('/slots/themes')
}

export function launchGame(gameUuid: string, device: 'mobile' | 'desktop' = 'mobile', currency?: string): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/slots/init', {
    method: 'POST',
    body: JSON.stringify({ gameUuid, device, currency }),
  })
}

export function launchDemo(gameUuid: string, device: 'mobile' | 'desktop' = 'mobile', currency?: string): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/slots/demo', {
    method: 'POST',
    body: JSON.stringify({ gameUuid, device, currency }),
  })
}

export interface BetRecord {
  uuid: string
  name: string
  nameId?: string | null
  nameVi?: string | null
  nameZh?: string | null
  provider: string
  imageUrl: string | null
  betAmount: number
}

export type BetTab = 'latest' | 'week' | 'month'

export function fetchBettingActivity(tab: BetTab): Promise<BetRecord[]> {
  return apiRequest<BetRecord[]>(`/slots/betting-activity?tab=${tab}`)
}
