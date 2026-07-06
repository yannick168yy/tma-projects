export interface Winner {
  name: string
  game: string
  amount: string
}

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
  { id: 'casino', label: 'Home' },
  { id: 'bonuses', label: 'Bonuses', badge: 3 },
  { id: 'team', label: '3-Circle' },
  { id: 'games', label: 'Games' },
  { id: 'menu', label: 'Menu' },
] as const
