export interface MenuGame {
  name: string
  provider: string
  icon: string
  hot: boolean
}

export interface MenuSubcat {
  id: string
  label: string
  icon: string
  count: number
  hot?: boolean
  isNew?: boolean
  color: string
  gradient: string
  games: MenuGame[]
}

export interface MenuSection {
  id: string
  label: string
  dot: string
  subcats: MenuSubcat[]
}

/** 与 Figma Make App.tsx MENU_DATA 一致 */
export const MENU_DATA: MenuSection[] = [
  {
    id: 'casino',
    label: 'Casino',
    dot: '#FFB800',
    subcats: [
      {
        id: 'popular',
        label: 'Popular',
        icon: '🔥',
        count: 88,
        hot: true,
        color: '#f97316',
        gradient: 'from-orange-600 to-red-700',
        games: [
          { name: 'Golden Fortune', provider: 'PGSOFT', icon: '🎰', hot: true },
          { name: 'Lucky Fiesta', provider: 'PRAGMATIC', icon: '🎊', hot: true },
          { name: 'Dragon Riches', provider: 'HABANERO', icon: '🐉', hot: true },
          { name: 'Peso Jackpot', provider: 'BGAMING', icon: '💎', hot: false },
          { name: 'Moneyfest', provider: 'POPIPLAY', icon: '🐷', hot: true },
          { name: 'Wild Bounty', provider: 'PGSOFT', icon: '🤠', hot: false },
        ],
      },
      {
        id: 'egames',
        label: 'E-Games',
        icon: '👾',
        count: 95,
        color: '#a78bfa',
        gradient: 'from-violet-700 to-indigo-800',
        games: [
          { name: 'Tarsier Blast', provider: 'PGSOFT', icon: '👾', hot: true },
          { name: 'Neon Fighter', provider: 'NETENT', icon: '🕹️', hot: false },
          { name: 'Fortune Rush', provider: 'HABANERO', icon: '⚡', hot: true },
          { name: 'Space Slots', provider: 'NOLIMIT', icon: '🚀', hot: false },
          { name: 'Cyber Riches', provider: 'BGAMING', icon: '💻', hot: true },
          { name: 'Pixel Race', provider: 'POPIPLAY', icon: '🏁', hot: false },
        ],
      },
      {
        id: 'quick',
        label: 'Quick Games',
        icon: '⚡',
        count: 42,
        color: '#38bdf8',
        gradient: 'from-cyan-700 to-blue-800',
        games: [
          { name: 'Aviator', provider: 'SPRIBE', icon: '✈️', hot: true },
          { name: 'Crash PH', provider: 'BGAMING', icon: '🚀', hot: true },
          { name: 'Plinko', provider: 'BGAMING', icon: '🎯', hot: false },
          { name: 'Mines', provider: 'BGAMING', icon: '💣', hot: false },
          { name: 'Dice Pro', provider: 'BGAMING', icon: '🎲', hot: false },
          { name: 'Keno Fast', provider: 'BGAMING', icon: '🔢', hot: false },
        ],
      },
      {
        id: 'new',
        label: 'New Games',
        icon: '✨',
        count: 24,
        isNew: true,
        color: '#f472b6',
        gradient: 'from-pink-700 to-fuchsia-800',
        games: [
          { name: 'Super Ace', provider: 'JILI', icon: '♠️', hot: true },
          { name: 'Fortune Gem', provider: 'JILI', icon: '💎', hot: false },
          { name: 'Candy Burst', provider: 'PGSOFT', icon: '🍬', hot: false },
          { name: 'Mahjong Ways 2', provider: 'PGSOFT', icon: '🀄', hot: true },
          { name: 'Dragon vs Tiger', provider: 'JILI', icon: '🐯', hot: false },
          { name: 'Mega Fishing', provider: 'JILI', icon: '🎣', hot: true },
        ],
      },
      {
        id: 'featured',
        label: 'Featured',
        icon: '⭐',
        count: 16,
        color: '#fbbf24',
        gradient: 'from-amber-600 to-yellow-700',
        games: [
          { name: 'Gates of Olympus', provider: 'PRAGMATIC', icon: '⚡', hot: true },
          { name: 'Sweet Bonanza', provider: 'PRAGMATIC', icon: '🍭', hot: false },
          { name: 'Starlight Princess', provider: 'PRAGMATIC', icon: '👸', hot: true },
          { name: 'Big Bass', provider: 'PRAGMATIC', icon: '🐟', hot: false },
          { name: 'Aztec Gems', provider: 'PRAGMATIC', icon: '💎', hot: false },
          { name: 'Wild West Gold', provider: 'PRAGMATIC', icon: '🤠', hot: true },
        ],
      },
      {
        id: 'bonusbuy',
        label: 'Bonus Buy',
        icon: '💰',
        count: 31,
        color: '#34d399',
        gradient: 'from-emerald-700 to-green-800',
        games: [
          { name: 'Book of Dead', provider: 'PLAYNGO', icon: '📖', hot: true },
          { name: 'Razor Shark', provider: 'PUSHGAMING', icon: '🦈', hot: false },
          { name: 'Deadwood', provider: 'NOLIMIT', icon: '💀', hot: true },
          { name: 'Tombstone', provider: 'NOLIMIT', icon: '🪦', hot: false },
          { name: 'Mental', provider: 'NOLIMIT', icon: '🧠', hot: false },
          { name: 'San Quentin', provider: 'NOLIMIT', icon: '⛓️', hot: true },
        ],
      },
    ],
  },
  {
    id: 'live',
    label: 'Live Casino',
    dot: '#3ECF8E',
    subcats: [
      {
        id: 'livegames',
        label: 'Live Games',
        icon: '🎴',
        count: 48,
        hot: true,
        color: '#10b981',
        gradient: 'from-emerald-800 to-teal-900',
        games: [
          { name: 'Baccarat PH', provider: 'EVOLUTION', icon: '🎴', hot: true },
          { name: 'Dragon Tiger', provider: 'PRAGMATIC', icon: '🐯', hot: true },
          { name: 'Sic Bo', provider: 'EVOLUTION', icon: '🎲', hot: false },
          { name: "Casino Hold'em", provider: 'EVOLUTION', icon: '♠️', hot: false },
          { name: 'Dream Catcher', provider: 'EVOLUTION', icon: '🎡', hot: true },
          { name: 'Monopoly Live', provider: 'EVOLUTION', icon: '🎩', hot: true },
        ],
      },
      {
        id: 'roulette',
        label: 'Roulette',
        icon: '🎡',
        count: 12,
        color: '#f87171',
        gradient: 'from-red-800 to-rose-900',
        games: [
          { name: 'Lightning Roulette', provider: 'EVOLUTION', icon: '⚡', hot: true },
          { name: 'Speed Roulette', provider: 'EVOLUTION', icon: '🎡', hot: false },
          { name: 'Immersive Roulette', provider: 'EVOLUTION', icon: '🎡', hot: false },
          { name: 'Double Ball', provider: 'EVOLUTION', icon: '🔴', hot: false },
          { name: 'Salon Privé', provider: 'EVOLUTION', icon: '🌹', hot: false },
          { name: 'Auto Roulette', provider: 'EVOLUTION', icon: '🎡', hot: true },
        ],
      },
      {
        id: 'blackjack',
        label: 'Blackjack',
        icon: '🃏',
        count: 10,
        color: '#94a3b8',
        gradient: 'from-slate-700 to-slate-900',
        games: [
          { name: 'Infinite Blackjack', provider: 'EVOLUTION', icon: '♾️', hot: true },
          { name: 'Power Blackjack', provider: 'EVOLUTION', icon: '⚡', hot: true },
          { name: 'Speed Blackjack', provider: 'EVOLUTION', icon: '🃏', hot: false },
          { name: 'Blackjack VIP', provider: 'EVOLUTION', icon: '🃏', hot: false },
          { name: 'Free Bet BJ', provider: 'EVOLUTION', icon: '🃏', hot: false },
          { name: 'Salon Privé BJ', provider: 'EVOLUTION', icon: '🌹', hot: false },
        ],
      },
      {
        id: 'baccarat',
        label: 'Baccarat',
        icon: '🎴',
        count: 14,
        color: '#818cf8',
        gradient: 'from-indigo-800 to-purple-900',
        games: [
          { name: 'Speed Baccarat', provider: 'EVOLUTION', icon: '🎴', hot: true },
          { name: 'Lightning Baccarat', provider: 'EVOLUTION', icon: '⚡', hot: true },
          { name: 'Golden Wealth Bac.', provider: 'EVOLUTION', icon: '💛', hot: false },
          { name: 'Baccarat Squeeze', provider: 'EVOLUTION', icon: '🎴', hot: false },
          { name: 'Mini Baccarat', provider: 'EVOLUTION', icon: '🎴', hot: false },
          { name: 'No Commission Bac.', provider: 'EVOLUTION', icon: '🎴', hot: false },
        ],
      },
      {
        id: 'gameshows',
        label: 'Game Shows',
        icon: '🎪',
        count: 8,
        isNew: true,
        color: '#e879f9',
        gradient: 'from-fuchsia-800 to-pink-900',
        games: [
          { name: 'Crazy Time', provider: 'EVOLUTION', icon: '🎪', hot: true },
          { name: 'Monopoly Live', provider: 'EVOLUTION', icon: '🎩', hot: true },
          { name: 'Cash or Crash', provider: 'EVOLUTION', icon: '🚀', hot: true },
          { name: 'Deal or No Deal', provider: 'EVOLUTION', icon: '💼', hot: false },
          { name: 'Dream Catcher', provider: 'EVOLUTION', icon: '🎡', hot: false },
          { name: "Gonzo's Treasure", provider: 'EVOLUTION', icon: '🗺️', hot: false },
        ],
      },
    ],
  },
]

const casinoSection = MENU_DATA.find((s) => s.id === 'casino')!
export const CASINO_SUBCATS = casinoSection.subcats

export const ALL_MENU_GAMES = MENU_DATA.flatMap((s) =>
  s.subcats.flatMap((c) => c.games.map((g) => ({ ...g, catId: c.id, gradient: c.gradient }))),
)
