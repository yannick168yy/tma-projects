import { apiRequest } from './client'

export interface HomeContentItem {
  kind: 'banner' | 'card'
  slot: number
  imageKey: string
  imageUrl: string
  actionType: 'promo' | 'cashback' | 'spin' | 'lobby' | 'none'
  actionValue: string | null
  enabled: boolean
}

export interface HomeContent {
  banners: HomeContentItem[]
  cards: HomeContentItem[]
}

export const fetchHomeContent = () => apiRequest<HomeContent>('/home/content')
