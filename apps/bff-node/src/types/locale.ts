export const SUPPORTED_LOCALES = ['en', 'id', 'vi', 'zh-CN'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export function isAppLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Map Telegram / browser tags to app locale; fallback en */
export function resolveLocaleFromTag(tag?: string | null): AppLocale {
  if (!tag) return 'en'
  const t = tag.toLowerCase().replace('_', '-')
  if (t.startsWith('zh')) return 'zh-CN'
  if (t.startsWith('id')) return 'id'
  if (t.startsWith('vi')) return 'vi'
  if (t.startsWith('en')) return 'en'
  return 'en'
}
