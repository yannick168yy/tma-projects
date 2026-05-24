export interface Category {
  icon: string
  label: string
  color: string
  badge: string | null
  nav: 'bonuses'
  promo: string | null
}

export const CATEGORIES: Category[] = [
  { icon: '🎁', label: 'Bonuses', color: 'from-purple-600 to-indigo-700', badge: null, nav: 'bonuses', promo: null },
  { icon: '🎖️', label: 'First Play', color: 'from-violet-600 to-purple-800', badge: '₱88', nav: 'bonuses', promo: 'trial' },
  { icon: '🤝', label: 'Refer & Win', color: 'from-emerald-600 to-teal-700', badge: null, nav: 'bonuses', promo: 'referral' },
  { icon: '💰', label: 'First Dep', color: 'from-orange-600 to-red-700', badge: '120%', nav: 'bonuses', promo: 'firstdep' },
]
