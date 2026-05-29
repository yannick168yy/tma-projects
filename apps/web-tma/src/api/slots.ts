import { apiRequest } from './client'

export interface SlotGame {
  uuid: string
  name: string
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
}

export interface GameHistoryItem {
  uuid: string
  name: string
  provider: string
  imageUrl: string | null
  imageHqUrl: string | null
  lastPlayedAt: string
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
  const q = qs.toString()
  return apiRequest<GameListResult>(`/slots/games${q ? `?${q}` : ''}`)
}

export function fetchGameHistory(limit = 10): Promise<GameHistoryItem[]> {
  return apiRequest<GameHistoryItem[]>(`/slots/history?limit=${limit}`)
}

export function fetchProviders(): Promise<string[]> {
  return apiRequest<string[]>('/slots/providers')
}

export function launchGame(gameUuid: string, device: 'mobile' | 'desktop' = 'mobile'): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/slots/init', {
    method: 'POST',
    body: JSON.stringify({ gameUuid, device }),
  })
}

export function launchDemo(gameUuid: string, device: 'mobile' | 'desktop' = 'mobile'): Promise<{ url: string }> {
  return apiRequest<{ url: string }>('/slots/demo', {
    method: 'POST',
    body: JSON.stringify({ gameUuid, device }),
  })
}

export function syncGames(): Promise<{ synced: number }> {
  return apiRequest<{ synced: number }>('/slots/sync', { method: 'POST' })
}
