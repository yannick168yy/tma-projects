import { apiRequest } from './client'

export interface HomeContentItem {
  kind: 'banner' | 'card' | 'wallet_banner'
  slot: number
  imageKey: string
  imageUrl: string
  actionType: 'promo' | 'cashback' | 'spin' | 'lobby' | 'none' | 'path' | 'url'
  actionValue: string | null
  enabled: boolean
}

export type HomeSocialPlatform = 'telegram' | 'facebook' | 'x' | 'instagram' | 'youtube' | 'tiktok' | 'viber' | 'whatsapp'

export interface HomeSocialLink {
  platform: HomeSocialPlatform
  url: string
}

export interface HomeContent {
  banners: HomeContentItem[]
  cards: HomeContentItem[]
  walletBanners: HomeContentItem[]
  socialLinks: HomeSocialLink[]
}

export const fetchHomeContent = () => apiRequest<HomeContent>('/home/content')
