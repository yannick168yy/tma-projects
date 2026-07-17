import { apiRequest } from './client'

export interface HomeContentItem {
  kind: 'banner' | 'wallet_banner'
  slot: number
  imageKey: string
  imageUrl: string
  actionType: 'promo' | 'cashback' | 'spin' | 'lobby' | 'none' | 'path' | 'url'
  actionValue: string | null
  enabled: boolean
}

export interface HomeContent {
  banners: HomeContentItem[]
  walletBanners: HomeContentItem[]
}

export const fetchHomeContent = () => apiRequest<HomeContent>('/home/content')
