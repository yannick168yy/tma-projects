export interface Banner {
  id: number
  gradient: string
  tag: string
  title: string
  sub: string
  badge: string
  badgeColor: string
}

export interface Winner {
  name: string
  game: string
  amount: string
}

export const BANNERS: Banner[] = [
  {
    id: 1,
    gradient: 'from-[#1a0533] via-[#4a0e82] to-[#c0392b]',
    tag: 'WELCOME BONUS',
    title: '100% UP TO\n₱50,000',
    sub: 'New player exclusive • First deposit',
    badge: '🎉',
    badgeColor: 'bg-yellow-400 text-black',
  },
  {
    id: 2,
    gradient: 'from-[#0a2444] via-[#1a4a8a] to-[#0d7b4f]',
    tag: 'DAILY CASHBACK',
    title: 'UP TO 15%\nCASHBACK',
    sub: 'Every day, no questions asked',
    badge: '💰',
    badgeColor: 'bg-emerald-400 text-black',
  },
  {
    id: 3,
    gradient: 'from-[#2d1a00] via-[#8b4513] to-[#c0392b]',
    tag: 'E-SABONG SPECIAL',
    title: 'LIBRE TAYA\nEVERY FRIDAY',
    sub: 'Exclusive for verified PH players',
    badge: '🐓',
    badgeColor: 'bg-red-500 text-white',
  },
  {
    id: 4,
    gradient: 'from-[#0a1a2e] via-[#1a3a5c] to-[#7b2d8b]',
    tag: 'VIP PROGRAM',
    title: 'MAGING VIP\nNGAYON',
    sub: 'Exclusive rewards & priority support',
    badge: '👑',
    badgeColor: 'bg-yellow-500 text-black',
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
