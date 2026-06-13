export interface Category {
  id: 'bonuses' | 'firstPlay' | 'referWin' | 'firstDep' | 'cashback'
  icon: string
  color: string
  badge: string | null
  nav: 'bonuses' | 'cashback'
  promo: string | null
}

export const CATEGORIES: Category[] = [
  { id: 'bonuses', icon: '🎁', color: 'from-purple-600 to-indigo-700', badge: null, nav: 'bonuses', promo: null },
  { id: 'firstPlay', icon: '🎖️', color: 'from-violet-600 to-purple-800', badge: '₱88', nav: 'bonuses', promo: 'trial' },
  { id: 'referWin', icon: '🤝', color: 'from-emerald-600 to-teal-700', badge: '₱50', nav: 'bonuses', promo: 'referral' },
  { id: 'firstDep', icon: '💰', color: 'from-orange-600 to-red-700', badge: '120%', nav: 'bonuses', promo: 'firstdep' },
  { id: 'cashback', icon: '💵', color: 'from-green-500 to-emerald-600', badge: '2%', nav: 'cashback', promo: null },
]
