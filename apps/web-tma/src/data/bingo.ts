export interface PinoyClassicGame {
  uuid: string
  name: string
  provider: string
  imageUrl: string
  tag: string
  tagBg: string
  tagFg: string
  bg: [string, string]
  emoji: string
}

export const PINOY_CLASSICS: PinoyClassicGame[] = [
  {
    uuid: '58f038e202409028258f3ed9581589db0eb50510',
    name: 'Color Game Extreme',
    provider: 'JILI',
    imageUrl: 'https://stage.gis-static.com/games/da481495311e13bed8405e0fcc115357/JiliGames/58f038e202409028258f3ed9581589db0eb50510.png',
    tag: 'HOT',
    tagBg: '#FFB800',
    tagFg: '#000',
    bg: ['#7f1d1d', '#ea580c'],
    emoji: '🎨',
  },
  {
    uuid: 'b58561e0b90249b18f6fe3d66bf65c74',
    name: 'Color Game',
    provider: 'JILI',
    imageUrl: 'https://stage.gis-static.com/games/da481495311e13bed8405e0fcc115357/JiliGames/b58561e0b90249b18f6fe3d66bf65c74.png',
    tag: 'CLASSIC',
    tagBg: '#ef4444',
    tagFg: '#fff',
    bg: ['#b91c1c', '#f97316'],
    emoji: '🟥',
  },
  {
    uuid: 'aa9e42ff386e49a0889492e7cbd4452a',
    name: 'Color Prediction',
    provider: 'JILI',
    imageUrl: 'https://stage.gis-static.com/games/da481495311e13bed8405e0fcc115357/JiliGames/aa9e42ff386e49a0889492e7cbd4452a.png',
    tag: 'PREDICT',
    tagBg: '#3b82f6',
    tagFg: '#fff',
    bg: ['#1e3a8a', '#6d28d9'],
    emoji: '🎯',
  },
  {
    uuid: 'a7943aa090104ddda8008b685fcbaeb2',
    name: 'Super E-Sabong',
    provider: 'JILI',
    imageUrl: 'https://stage.gis-static.com/games/da481495311e13bed8405e0fcc115357/JiliGames/a7943aa090104ddda8008b685fcbaeb2.png',
    tag: 'SABONG',
    tagBg: '#ec4899',
    tagFg: '#fff',
    bg: ['#7f1d1d', '#dc2626'],
    emoji: '🐓',
  },
  {
    uuid: '6721efc3f16f42cd907155d79d560030',
    name: 'CockFighting',
    provider: 'Rich88',
    imageUrl: 'https://stage.gis-static.com/games/Rich88/6721efc3f16f42cd907155d79d560030.png',
    tag: 'FIGHTING',
    tagBg: '#78350f',
    tagFg: '#fff',
    bg: ['#78350f', '#b91c1c'],
    emoji: '⚔️',
  },
  {
    uuid: '672cf996d4be4bcd8d6c7c847258ca33',
    name: 'Sic Bo',
    provider: 'JILI',
    imageUrl: 'https://stage.gis-static.com/games/da481495311e13bed8405e0fcc115357/JiliGames/672cf996d4be4bcd8d6c7c847258ca33.png',
    tag: 'DICE',
    tagBg: '#059669',
    tagFg: '#fff',
    bg: ['#064e3b', '#0d9488'],
    emoji: '🎲',
  },
]

export const PERYA_WINNERS = [
  { name: 'M***a', game: 'Bingo 90', amount: '₱91,000' },
  { name: 'R***o', game: 'Color Game', amount: '₱12,600' },
  { name: 'J***n', game: 'Pula Puti', amount: '₱8,200' },
  { name: 'A***y', game: 'Drop Ball', amount: '₱25,500' },
  { name: 'C***e', game: 'Bingo 75', amount: '₱48,000' },
  { name: 'B***g', game: 'STL Pares', amount: '₱6,800' },
]
