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
  imageAnim?: string | null
  imageSource?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  hasLobby: boolean
  isMobile: boolean
  weight: number
  isFeatured: boolean
  /** Cashback Games 精选档位角标：elite=2% / pro=1.5%（纯展示） */
  cashbackTier?: 'elite' | 'pro' | null
  supportedCurrencies?: string[] | null
  supportsActiveCurrency?: boolean
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
  siteCategory?: string
  sortBy?: 'weight' | 'name'
  currency?: string
}

export interface HomepageGames {
  popular: SlotGame[]
  recommended: SlotGame[]
  newGames: SlotGame[]
  slots: SlotGame[]
  casino: SlotGame[]
  perya: SlotGame[]
  fishing: SlotGame[]
  lottery: SlotGame[]
  baccarat: SlotGame[]
  highRtp: SlotGame[]
  sports: SlotGame[]
  generatedAt: string
}

export interface GameHistoryItem {
  uuid: string
  name: string
  nameId: string | null
  nameVi: string | null
  nameZh: string | null
  provider: string
  imageUrl: string | null
  imageHqUrl: string | null
  lastPlayedAt: string
}

export function fetchGameHistory(limit = 10): Promise<GameHistoryItem[]> {
  return apiRequest<GameHistoryItem[]>(`/slots/history?limit=${limit}`)
}

export function fetchHomepageGames(currency?: string): Promise<HomepageGames> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : ''
  return apiRequest<HomepageGames>(`/slots/homepage${qs}`)
}

export function fetchGames(params: GameListParams = {}): Promise<GameListResult> {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.search) qs.set('search', params.search)
  if (params.provider && params.provider !== 'all') qs.set('provider', params.provider)
  if (params.category && params.category !== 'all') qs.set('category', params.category)
  if (params.sortCategory) qs.set('sortCategory', params.sortCategory)
  if (params.siteCategory) qs.set('siteCategory', params.siteCategory)
  if (params.sortBy) qs.set('sortBy', params.sortBy)
  if (params.currency) qs.set('currency', params.currency)
  const q = qs.toString()
  return apiRequest<GameListResult>(`/slots/games${q ? `?${q}` : ''}`)
}

export function fetchProviders(sortCategory?: string, siteCategory?: string): Promise<string[]> {
  const qs = new URLSearchParams()
  if (sortCategory) qs.set('sortCategory', sortCategory)
  if (siteCategory) qs.set('siteCategory', siteCategory)
  const q = qs.toString()
  return apiRequest<string[]>(`/slots/providers${q ? `?${q}` : ''}`)
}

export function launchGame(gameUuid: string, device: 'mobile' | 'desktop' = 'mobile', currency?: string): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/slots/init', {
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
