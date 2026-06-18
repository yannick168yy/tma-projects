import bonusesImg from '@/assets/home/promos/bonuses.webp'
import cashbackImg from '@/assets/home/promos/cashback.webp'
import firstDepImg from '@/assets/home/promos/first-dep.webp'
import firstPlayImg from '@/assets/home/promos/first-play.webp'
import referWinImg from '@/assets/home/promos/refer-win.webp'
import rewardsSpinImg from '@/assets/home/promos/rewards-spin.webp'

export interface Category {
  id: 'bonuses' | 'firstPlay' | 'referWin' | 'firstDep' | 'cashback' | 'rewardsSpin'
  icon: string
  image: string
  color: string
  badge: string | null
  offer: string
  nav: 'bonuses' | 'cashback' | 'spin'
  promo: string | null
}

export const CATEGORIES: Category[] = [
  { id: 'cashback', icon: '🧧', image: cashbackImg, color: 'from-fuchsia-500/85 to-purple-800', badge: '2%', offer: '1.50%', nav: 'cashback', promo: null },
  { id: 'rewardsSpin', icon: '🎡', image: rewardsSpinImg, color: 'from-lime-600/85 to-emerald-800', badge: 'SPIN', offer: '₱15,780', nav: 'spin', promo: null },
  { id: 'referWin', icon: '🤝', image: referWinImg, color: 'from-orange-500/90 to-orange-800', badge: '₱50', offer: '₱4,700', nav: 'bonuses', promo: 'referral' },
  { id: 'firstDep', icon: '💰', image: firstDepImg, color: 'from-emerald-600/85 to-teal-900', badge: '120%', offer: '120%', nav: 'bonuses', promo: 'firstdep' },
  { id: 'firstPlay', icon: '🎖️', image: firstPlayImg, color: 'from-violet-600/85 to-fuchsia-900', badge: '₱88', offer: '₱88', nav: 'bonuses', promo: 'trial' },
  { id: 'bonuses', icon: '🎁', image: bonusesImg, color: 'from-sky-600/85 to-blue-900', badge: null, offer: '777', nav: 'bonuses', promo: null },
]
