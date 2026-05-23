export interface Banner {
  id: number
  gradient: string
  tag: string
  title: string
  sub: string
  badge: string
  badgeColor: string
}

export interface GameItem {
  id: number
  name: string
  provider: string
  gradient: string
  icon: string
  hot?: boolean
}

export interface EGameItem extends GameItem {
  players: number
}

export interface LiveGameItem {
  id: number
  name: string
  dealer: string
  players: number
  gradient: string
  icon: string
}

export interface Provider {
  name: string
  color: string
  abbr: string
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

export const GAME_TABS = [
  { id: 'all', label: 'All Games' },
  { id: 'slots', label: 'Slots' },
  { id: 'egames', label: 'E-Games' },
  { id: 'sports', label: 'Sports' },
  { id: 'sabong', label: 'Sabong' },
] as const

export type GameTabId = (typeof GAME_TABS)[number]['id']

export const HISTORY_GAMES: GameItem[] = [
  {
    id: 1,
    name: 'WILD BOUNTY\nSHOWDOWN',
    provider: 'PGSOFT',
    gradient: 'from-amber-800 via-amber-600 to-yellow-400',
    icon: '🤠',
  },
  {
    id: 2,
    name: 'MONEYFEST',
    provider: 'POPIPLAY',
    gradient: 'from-orange-800 via-orange-600 to-yellow-400',
    icon: '🐷',
  },
  {
    id: 3,
    name: 'AVIATORS PH',
    provider: 'BGAMING',
    gradient: 'from-blue-900 via-sky-700 to-cyan-500',
    icon: '✈️',
  },
]

export const POPULAR_GAMES: GameItem[] = [
  { id: 1, name: 'GOLDEN FORTUNE', provider: 'PGSOFT', gradient: 'from-yellow-700 via-amber-600 to-yellow-400', icon: '🎰', hot: true },
  { id: 2, name: 'LUCKY FIESTA', provider: 'PRAGMATIC', gradient: 'from-red-800 via-red-600 to-orange-400', icon: '🎊', hot: true },
  { id: 3, name: 'MANILA NIGHTS', provider: 'POPIPLAY', gradient: 'from-blue-900 via-indigo-700 to-purple-500', icon: '🌃', hot: false },
  { id: 4, name: 'PESO JACKPOT', provider: 'BGAMING', gradient: 'from-green-800 via-emerald-600 to-lime-400', icon: '💎', hot: false },
  { id: 5, name: 'DRAGON RICHES', provider: 'HABANERO', gradient: 'from-red-900 via-red-700 to-yellow-500', icon: '🐉', hot: true },
  { id: 6, name: 'ISLAND REELS', provider: 'NOLIMIT', gradient: 'from-cyan-800 via-teal-600 to-emerald-400', icon: '🏝️', hot: false },
  { id: 7, name: 'BACCARAT KING', provider: 'EVOLUTION', gradient: 'from-slate-800 via-slate-600 to-gray-400', icon: '🃏', hot: false },
  { id: 8, name: 'MONEYFEST', provider: 'POPIPLAY', gradient: 'from-orange-800 via-orange-600 to-yellow-400', icon: '🐷', hot: true },
  { id: 9, name: 'TARSIER BLAST', provider: 'BGAMING', gradient: 'from-violet-900 via-purple-700 to-indigo-500', icon: '👁️', hot: false },
]

export const EGAMES: EGameItem[] = [
  { id: 1, name: 'Tarsier Blast', provider: 'PGSOFT', players: 892, gradient: 'from-violet-900 to-indigo-700', icon: '👾', hot: true },
  { id: 2, name: 'Neon Fighter', provider: 'NETENT', players: 1204, gradient: 'from-cyan-900 to-blue-700', icon: '🕹️', hot: false },
  { id: 3, name: 'Fortune Rush', provider: 'HABANERO', players: 654, gradient: 'from-orange-900 to-amber-700', icon: '⚡', hot: true },
  { id: 4, name: 'Dragon Quest', provider: 'BGAMING', players: 445, gradient: 'from-red-900 to-rose-700', icon: '🐉', hot: false },
  { id: 5, name: 'Space Slots', provider: 'NOLIMIT', players: 330, gradient: 'from-slate-900 to-indigo-900', icon: '🚀', hot: false },
  { id: 6, name: 'Riches Road', provider: 'PRAGMATIC', players: 788, gradient: 'from-green-900 to-emerald-700', icon: '🤑', hot: true },
]

export const LIVE_GAMES: LiveGameItem[] = [
  { id: 1, name: 'Baccarat PH', dealer: 'Dealer Maria', players: 234, gradient: 'from-emerald-900 to-emerald-700', icon: '🎴' },
  { id: 2, name: 'Roulette Live', dealer: 'Dealer Ana', players: 189, gradient: 'from-red-900 to-red-700', icon: '🎡' },
  { id: 3, name: 'Dragon Tiger', dealer: 'Dealer Jose', players: 312, gradient: 'from-purple-900 to-purple-700', icon: '🐯' },
  { id: 4, name: 'Blackjack VIP', dealer: 'Dealer Kim', players: 97, gradient: 'from-slate-900 to-slate-700', icon: '🃏' },
]

export const WINNERS: Winner[] = [
  { name: 'J***o', game: 'Golden Fortune', amount: '₱48,200' },
  { name: 'M***a', game: 'Lucky Fiesta', amount: '₱22,500' },
  { name: 'R***l', game: 'Dragon Riches', amount: '₱91,000' },
  { name: 'C***e', game: 'Peso Jackpot', amount: '₱15,750' },
  { name: 'A***n', game: 'Aviators PH', amount: '₱33,300' },
]

export const PROVIDERS: Provider[] = [
  { name: 'PGSOFT', color: 'from-orange-500 to-red-600', abbr: 'PG' },
  { name: 'PRAGMATIC', color: 'from-red-600 to-rose-700', abbr: 'PP' },
  { name: 'BGAMING', color: 'from-blue-600 to-indigo-700', abbr: 'BG' },
  { name: 'EVOLUTION', color: 'from-slate-600 to-slate-800', abbr: 'EVO' },
  { name: 'HABANERO', color: 'from-yellow-500 to-orange-600', abbr: 'HAB' },
  { name: 'NOLIMIT', color: 'from-purple-600 to-violet-700', abbr: 'NLC' },
  { name: 'NETENT', color: 'from-emerald-600 to-teal-700', abbr: 'NET' },
  { name: 'POPIPLAY', color: 'from-pink-600 to-rose-600', abbr: 'POP' },
]

export const NAV_ITEMS = [
  { id: 'cashier', label: 'Cashier' },
  { id: 'bingo', label: 'Bingo' },
  { id: 'bonuses', label: 'Bonuses', badge: 3 },
  { id: 'casino', label: 'Casino' },
  { id: 'menu', label: 'Menu' },
] as const
