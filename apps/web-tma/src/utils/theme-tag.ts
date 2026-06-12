import type { TFunction } from 'i18next'
import { i18n } from '@/i18n'
import { resolveThemeLocale, translateThemeSlug } from '@/i18n/themeSlugI18n'

// theme 字段 → 颜色 [bg, fg]
export const GAME_THEME_SLUGS = [
  'fortune', 'asian-fortune', 'fortune-gems', 'luck', 'lucky', 'jackpot', 'money', 'treasure', 'gold', 'luxury',
  'fantasy', 'magic', 'mystery', 'mythology', 'greek-mythology', 'norse-mythology', 'asian-mythology', 'legend', 'wizard', 'fairy', 'fairy-tale', 'mystical',
  'adventure', 'sci-fi', 'space', 'space-adventure', 'futuristic', 'ocean', 'underwater', 'nautical', 'pirate',
  'nature', 'fishing', 'jungle', 'safari', 'farm', 'farming', 'wildlife',
  'horror', 'action', 'war', 'battle', 'fighting', 'military', 'sports', 'racing',
  'dragon', 'dragon-tiger', 'asian', 'asian-culture', 'mahjong', 'samurai', 'ninja',
  'classic', 'retro', 'vintage', 'western', 'joker',
  'carnival', 'fiesta', 'fiesta-fortune', 'party', 'festival', 'circus', 'candy',
  'fruit', 'food', 'sweet', 'sweets',
  'egyptian', 'ancient-egypt', 'ancient', 'aztec', 'mayan',
  'animals', 'animal', 'tiger',
  'dice', 'card', 'card-game', 'poker', 'bingo', 'keno', 'lottery', 'roulette', 'baccarat', 'teenpatti',
  'christmas', 'halloween',
  'crime', 'heist', 'gangster', 'spy', 'mafia', 'prison',
] as const

const COLOR_MAP: Record<string, [string, string]> = {
  // 金/琥珀
  fortune:          ['#d97706', '#000'],
  'asian-fortune':  ['#d97706', '#000'],
  'fortune-gems':   ['#d97706', '#000'],
  luck:             ['#d97706', '#000'],
  lucky:            ['#FFB800', '#000'],
  jackpot:          ['#FFB800', '#000'],
  money:            ['#FFB800', '#000'],
  treasure:         ['#b45309', '#fff'],
  gold:             ['#FFB800', '#000'],
  luxury:           ['#b45309', '#fff'],

  // 紫/魔法
  fantasy:          ['#7c3aed', '#fff'],
  magic:            ['#7c3aed', '#fff'],
  mystery:          ['#6d28d9', '#fff'],
  mythology:        ['#6d28d9', '#fff'],
  'greek-mythology':['#6d28d9', '#fff'],
  'norse-mythology':['#6d28d9', '#fff'],
  'asian-mythology':['#be185d', '#fff'],
  legend:           ['#7c3aed', '#fff'],
  wizard:           ['#7c3aed', '#fff'],
  fairy:            ['#a855f7', '#fff'],
  'fairy-tale':     ['#a855f7', '#fff'],
  mystical:         ['#6d28d9', '#fff'],

  // 蓝/科幻
  adventure:        ['#2563eb', '#fff'],
  'sci-fi':         ['#0284c7', '#fff'],
  space:            ['#0284c7', '#fff'],
  'space-adventure':['#0284c7', '#fff'],
  futuristic:       ['#0369a1', '#fff'],
  ocean:            ['#0369a1', '#fff'],
  underwater:       ['#0369a1', '#fff'],
  nautical:         ['#1e40af', '#fff'],
  pirate:           ['#1e3a8a', '#fff'],

  // 绿/自然
  nature:           ['#16a34a', '#fff'],
  fishing:          ['#059669', '#fff'],
  jungle:           ['#15803d', '#fff'],
  safari:           ['#15803d', '#fff'],
  farm:             ['#16a34a', '#fff'],
  farming:          ['#16a34a', '#fff'],
  wildlife:         ['#15803d', '#fff'],

  // 红/动作
  horror:           ['#dc2626', '#fff'],
  action:           ['#dc2626', '#fff'],
  war:              ['#b91c1c', '#fff'],
  battle:           ['#b91c1c', '#fff'],
  fighting:         ['#dc2626', '#fff'],
  military:         ['#991b1b', '#fff'],
  sports:           ['#dc2626', '#fff'],
  racing:           ['#dc2626', '#fff'],

  // 龙/亚洲
  dragon:           ['#ef4444', '#fff'],
  'dragon-tiger':   ['#ef4444', '#fff'],
  asian:            ['#ec4899', '#fff'],
  'asian-culture':  ['#ec4899', '#fff'],
  mahjong:          ['#be185d', '#fff'],
  samurai:          ['#991b1b', '#fff'],
  ninja:            ['#1e293b', '#fff'],

  // 橙/经典
  classic:          ['#ea580c', '#fff'],
  retro:            ['#ea580c', '#fff'],
  vintage:          ['#92400e', '#fff'],
  western:          ['#92400e', '#fff'],
  joker:            ['#ea580c', '#fff'],

  // 粉/嘉年华
  carnival:         ['#ec4899', '#fff'],
  fiesta:           ['#f97316', '#fff'],
  'fiesta-fortune': ['#f97316', '#fff'],
  party:            ['#a855f7', '#fff'],
  festival:         ['#f97316', '#fff'],
  circus:           ['#ec4899', '#fff'],
  candy:            ['#ec4899', '#fff'],

  // 食物/水果
  fruit:            ['#16a34a', '#fff'],
  food:             ['#f97316', '#fff'],
  sweet:            ['#ec4899', '#fff'],
  sweets:           ['#ec4899', '#fff'],

  // 古代/埃及
  egyptian:         ['#b45309', '#fff'],
  'ancient-egypt':  ['#b45309', '#fff'],
  ancient:          ['#b45309', '#fff'],
  aztec:            ['#92400e', '#fff'],
  mayan:            ['#92400e', '#fff'],

  // 动物
  animals:          ['#15803d', '#fff'],
  animal:           ['#15803d', '#fff'],
  tiger:            ['#ea580c', '#fff'],

  // 骰子/牌
  dice:             ['#059669', '#fff'],
  card:             ['#1e3a8a', '#fff'],
  'card-game':      ['#1e3a8a', '#fff'],
  poker:            ['#1e3a8a', '#fff'],
  bingo:            ['#7c3aed', '#fff'],
  keno:             ['#0369a1', '#fff'],
  lottery:          ['#d97706', '#000'],
  roulette:         ['#1e3a8a', '#fff'],
  baccarat:         ['#1e3a8a', '#fff'],
  'teenpatti':      ['#6d28d9', '#fff'],

  // 节日
  christmas:        ['#dc2626', '#fff'],
  halloween:        ['#ea580c', '#000'],

  // 犯罪/都市
  crime:            ['#475569', '#fff'],
  heist:            ['#475569', '#fff'],
  gangster:         ['#1e293b', '#fff'],
  'spy':            ['#334155', '#fff'],
  mafia:            ['#1e293b', '#fff'],
  prison:           ['#334155', '#fff'],
}

// 确定性兜底色盘（theme 不在 MAP 时按字符哈希选色，同一 theme 永远同色）
const FALLBACK_PALETTE: Array<[string, string]> = [
  ['#3b82f6', '#fff'],
  ['#8b5cf6', '#fff'],
  ['#06b6d4', '#fff'],
  ['#10b981', '#fff'],
  ['#f59e0b', '#000'],
  ['#ef4444', '#fff'],
  ['#ec4899', '#fff'],
  ['#0ea5e9', '#fff'],
]

function hashPick(theme: string): [string, string] {
  let h = 0
  for (let i = 0; i < theme.length; i++) h = (h + theme.charCodeAt(i)) & 0xffff
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length]
}

export function themeSlugFallbackLabel(theme: string): string {
  return theme.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function themeColors(theme: string | null): { bg: string; fg: string } | null {
  if (!theme) return null
  const [bg, fg] = COLOR_MAP[theme] ?? hashPick(theme)
  return { bg, fg }
}

export function localizedThemeLabel(theme: string, _t: TFunction): string {
  const locale = resolveThemeLocale(i18n.language)
  return translateThemeSlug(theme, locale)
}

export function localizedThemeTag(theme: string | null, t: TFunction): { label: string; bg: string; fg: string } | null {
  const colors = themeColors(theme)
  if (!theme || !colors) return null
  return { label: localizedThemeLabel(theme, t), ...colors }
}

/** @deprecated 使用 localizedThemeTag */
export function themeTag(theme: string | null): { label: string; bg: string; fg: string } | null {
  const colors = themeColors(theme)
  if (!theme || !colors) return null
  return { label: theme.replace(/-/g, ' ').toUpperCase(), ...colors }
}
