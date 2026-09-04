/**
 * 租户文案覆盖（P1-11）。由 `/site/config` bootstrap 下发，
 * 在 i18n 初始化时 merge 进资源。
 *
 * 存扁平点号键（checkin.title），与平台后台、`infra/i18n/keys.en.json` 同一套口径。
 */

let overrides: Record<string, Record<string, string>> = {}

export function setI18nOverrides(input: unknown): void {
  if (!input || typeof input !== 'object') return
  const out: Record<string, Record<string, string>> = {}
  for (const [locale, entries] of Object.entries(input as Record<string, unknown>)) {
    if (!entries || typeof entries !== 'object') continue
    const map: Record<string, string> = {}
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof value === 'string') map[key] = value
    }
    if (Object.keys(map).length > 0) out[locale] = map
  }
  overrides = out
}

export function getI18nOverrides(): Record<string, Record<string, string>> {
  return overrides
}
