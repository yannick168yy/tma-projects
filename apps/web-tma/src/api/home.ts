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

// 图片由服务端按访问域名所属站点选取
export const fetchHomeContent = () => apiRequest<HomeContent>('/home/content')
