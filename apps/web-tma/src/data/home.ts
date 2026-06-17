import firstDepositBanner from '@/assets/home/banners/first-deposit.webp'
import gamesBanner from '@/assets/home/banners/games.webp'
import referralBanner from '@/assets/home/banners/referral.webp'
import trialChipsBanner from '@/assets/home/banners/trial-chips.webp'

export interface Banner {
  id: number
  gradient: string
  image: string
  tag: string
  title: string
  sub: string
  badge: string
  badgeColor: string
  ctaAction: string
}

export interface Winner {
  name: string
  game: string
  amount: string
}

export const BANNERS: Banner[] = [
  {
    id: 1,
    gradient: 'from-[#2d1200] via-[#8b4000] to-[#c07000]',
    image: firstDepositBanner,
    tag: 'FIRST DEPOSIT',
    title: '120% UP TO\n₱1,000',
    sub: 'Min ₱100 · 15x wagering req',
    badge: '💰',
    badgeColor: 'bg-orange-500 text-white',
    ctaAction: 'firstdep',
  },
  {
    id: 2,
    gradient: 'from-[#1a0533] via-[#4a0e82] to-[#7b2d8b]',
    image: trialChipsBanner,
    tag: 'FREE TRIAL CHIPS',
    title: 'GET ₱88\nFREE CHIPS',
    sub: 'No deposit · New players only',
    badge: '🎖️',
    badgeColor: 'bg-violet-500 text-white',
    ctaAction: 'trial',
  },
  {
    id: 3,
    gradient: 'from-[#0a2e1a] via-[#1a6a3a] to-[#0d7b4f]',
    image: referralBanner,
    tag: 'REFER & EARN',
    title: 'EARN ₱50\nPER FRIEND',
    sub: 'Your friend gets ₱30 bonus too',
    badge: '🤝',
    badgeColor: 'bg-emerald-500 text-white',
    ctaAction: 'referral',
  },
  {
    id: 4,
    gradient: 'from-[#0a1a2e] via-[#1a3a5c] to-[#2a4f8b]',
    image: gamesBanner,
    tag: 'PREMIUM GAMES',
    title: '1000+\nGAMES',
    sub: 'JILI · PGSOFT · Evolution · 20+ studios',
    badge: '🎮',
    badgeColor: 'bg-blue-500 text-white',
    ctaAction: 'lobby',
  },
]

export const WINNERS: Winner[] = [
  { name: 'J***o', game: 'Golden Fortune', amount: '₱48,200' },
  { name: 'M***a', game: 'Lucky Fiesta', amount: '₱22,500' },
  { name: 'R***l', game: 'Dragon Riches', amount: '₱91,000' },
  { name: 'C***e', game: 'Peso Jackpot', amount: '₱15,750' },
  { name: 'A***n', game: 'Aviators PH', amount: '₱33,300' },
]

export const INFO_LINKS = [
  { key: 'terms' },
  { key: 'privacy' },
  { key: 'responsible' },
  { key: 'about' },
]

export const NAV_ITEMS = [
  { id: 'cashier', label: 'Cashier' },
  { id: 'bingo', label: 'Bingo' },
  { id: 'casino', label: 'Casino' },
  { id: 'bonuses', label: 'Bonuses', badge: 3 },
  { id: 'menu', label: 'Menu' },
] as const
