/**
 * 租户功能开关（P1-8）。由 `/site/config` 随站点配置一起下发，
 * 在 `initSiteMarketConfig()` 里填充。
 */

let features: Record<string, boolean> | null = null

export function setSiteFeatures(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
  if (entries.length > 0) features = Object.fromEntries(entries)
}

/**
 * 拉不到开关时一律按开启处理。
 *
 * 反过来（按关闭处理）会把一次 `/site/config` 抖动变成"整站功能全消失"，
 * 比"没开通的入口多露了一会儿"严重得多；且点进去后端 requireFeature 照样 403，
 * 前端这层本来就只是体验层，不是安全边界。
 */
export function isFeatureEnabled(key: string): boolean {
  return features === null || features[key] !== false
}
