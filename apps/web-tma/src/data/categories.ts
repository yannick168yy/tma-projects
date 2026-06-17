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
  nav: 'bonuses' | 'cashback' | 'spin'
  promo: string | null
}

export const CATEGORIES: Category[] = [
  { id: 'cashback', icon: '🧧', image: cashbackImg, color: 'from-red-500 to-amber-500', badge: '2%', nav: 'cashback', promo: null },
  { id: 'rewardsSpin', icon: '🎡', image: rewardsSpinImg, color: 'from-yellow-500 to-red-600', badge: 'SPIN', nav: 'spin', promo: null },
  { id: 'bonuses', icon: '🎁', image: bonusesImg, color: 'from-purple-600 to-indigo-700', badge: null, nav: 'bonuses', promo: null },
  { id: 'firstPlay', icon: '🎖️', image: firstPlayImg, color: 'from-violet-600 to-purple-800', badge: '₱88', nav: 'bonuses', promo: 'trial' },
  { id: 'referWin', icon: '🤝', image: referWinImg, color: 'from-emerald-600 to-teal-700', badge: '₱50', nav: 'bonuses', promo: 'referral' },
  { id: 'firstDep', icon: '💰', image: firstDepImg, color: 'from-orange-600 to-red-700', badge: '120%', nav: 'bonuses', promo: 'firstdep' },
]
