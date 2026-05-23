export interface PeryaMainGame {
  id: string
  label: string
  sub: string
  emoji: string
  players: number
  prize: string
  bg: [string, string, string]
  glow: string
  tag: string
  tagBg: string
  tagFg: string
  stars?: boolean
}

export const PERYA_MAIN: PeryaMainGame[] = [
  {
    id: 'bingo',
    label: 'BINGO',
    sub: '75 & 90 Ball',
    emoji: '🎱',
    players: 2841,
    prize: '₱500,000',
    bg: ['#4c0091', '#7c3aed', '#a855f7'],
    glow: '#a855f7',
    tag: 'JACKPOT',
    tagBg: '#FFB800',
    tagFg: '#000',
    stars: true,
  },
  {
    id: 'colorgame',
    label: 'COLOR GAME',
    sub: 'Paborito sa Perya',
    emoji: '🎨',
    players: 1509,
    prize: '30×',
    bg: ['#b91c1c', '#ea580c', '#f59e0b'],
    glow: '#f59e0b',
    tag: 'PERYA HIT',
    tagBg: '#f97316',
    tagFg: '#fff',
  },
  {
    id: 'dropball',
    label: 'DROP BALL',
    sub: 'Plinko-Style',
    emoji: '🔴',
    players: 876,
    prize: '50×',
    bg: ['#065f46', '#059669', '#34d399'],
    glow: '#34d399',
    tag: 'TRENDING',
    tagBg: '#10b981',
    tagFg: '#000',
  },
  {
    id: 'perya',
    label: 'PERYA LIVE',
    sub: 'Carnival Live Table',
    emoji: '🎡',
    players: 2204,
    prize: '100×',
    bg: ['#6b21a8', '#c026d3', '#f97316'],
    glow: '#f97316',
    tag: 'FIESTA',
    tagBg: '#ec4899',
    tagFg: '#fff',
  },
  {
    id: 'pulaputi',
    label: 'PULA PUTI',
    sub: 'Red or White',
    emoji: '🃏',
    players: 3102,
    prize: '2×',
    bg: ['#7f1d1d', '#dc2626', '#f87171'],
    glow: '#f87171',
    tag: 'MOST PLAYED',
    tagBg: '#ef4444',
    tagFg: '#fff',
  },
]

export const PERYA_GRID = [
  { id: 'swertres', label: 'Swertres', emoji: '3️⃣', players: 654, bg: ['#1e3a8a', '#3b82f6'], tag: 'Numbers' },
  { id: 'stl', label: 'STL Pares', emoji: '🎯', players: 449, bg: ['#134e4a', '#0d9488'], tag: 'Local' },
  { id: 'lasttwo', label: 'Last Two', emoji: '🎰', players: 321, bg: ['#78350f', '#d97706'], tag: 'Pick 2' },
  { id: 'keno', label: 'Keno PH', emoji: '🔢', players: 512, bg: ['#4c1d95', '#8b5cf6'], tag: 'Pick 10' },
  { id: 'sabong', label: 'E-Sabong', emoji: '🐓', players: 1890, bg: ['#7f1d1d', '#dc2626'], tag: 'LIVE' },
  { id: 'jaialai', label: 'Jai Alai', emoji: '🏟️', players: 210, bg: ['#1e293b', '#475569'], tag: 'Revival' },
]

export const PERYA_WINNERS = [
  { name: 'M***a', game: 'Bingo 90', amount: '₱91,000' },
  { name: 'R***o', game: 'Color Game', amount: '₱12,600' },
  { name: 'J***n', game: 'Pula Puti', amount: '₱8,200' },
  { name: 'A***y', game: 'Drop Ball', amount: '₱25,500' },
  { name: 'C***e', game: 'Bingo 75', amount: '₱48,000' },
  { name: 'B***g', game: 'STL Pares', amount: '₱6,800' },
]
