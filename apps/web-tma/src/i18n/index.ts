import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getSiteName } from '@/config/brand'
import { getI18nOverrides } from '@/config/i18n-overrides'
import en from '@/i18n/locales/en'
import id from '@/i18n/locales/id'
import idComplete from '@/i18n/locales/id-complete'
import vi from '@/i18n/locales/vi'
import zhCN from '@/i18n/locales/zh-CN'
import { isSupportedLocale, LOCALE_STORAGE_KEY, type SupportedLocale } from '@/i18n/types'
import { defaultMarketLocale } from '@/config/market'

// URL 语言别名 → 站点标准 locale，方便外部链接用短码
const LOCALE_ALIASES: Record<string, SupportedLocale> = {
  en: 'en',
  'en-us': 'en',
  id: 'id',
  'id-id': 'id',
  vi: 'vi',
  'vi-vn': 'vi',
  zh: 'zh-CN',
  cn: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
}

// 从 URL query（?lang=xx / ?locale=xx）解析语言，支持别名与大小写
function readUrlLocale(): SupportedLocale | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('lang') ?? params.get('locale')
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (LOCALE_ALIASES[normalized]) return LOCALE_ALIASES[normalized]
  if (isSupportedLocale(raw)) return raw
  return null
}

function readStoredLocale(): SupportedLocale {
  const fromUrl = readUrlLocale()
  if (fromUrl) {
    // URL 显式指定优先级最高，命中后持久化，刷新/内部跳转仍保留
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, fromUrl)
    } catch {
      // localStorage 不可用（隐私模式等）时忽略，仅本次会话生效
    }
    return fromUrl
  }
  if (typeof localStorage === 'undefined') return 'en'
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored && isSupportedLocale(stored)) return stored
  const telegramLanguage = window.Telegram?.WebApp.initDataUnsafe?.user?.language_code
  const detected = [telegramLanguage, ...(navigator.languages ?? []), navigator.language]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase())
    .map((value) => LOCALE_ALIASES[value] ?? LOCALE_ALIASES[value.split('-')[0]])
    .find(Boolean)
  if (detected) return detected
  return defaultMarketLocale()
}

export const i18n = i18next.createInstance()

function mergeTranslations(base: Record<string, unknown>, supplement: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base }
  for (const [key, value] of Object.entries(supplement)) {
    const current = result[key]
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeTranslations((current && typeof current === 'object' ? current : {}) as Record<string, unknown>, value as Record<string, unknown>)
      : value
  }
  return result
}

void i18n.use(initReactI18next).init({
  lng: readStoredLocale(),
  fallbackLng: 'en',
  resources: {
    en: { translation: en },
    id: { translation: mergeTranslations(id, idComplete) },
    vi: { translation: vi },
    'zh-CN': { translation: zhCN },
  },
  // brandName 作为全局插值变量下发给所有文案（P1-10/P1-12）：
  // 品牌名散落在十几条文案里，逐条传参会漏，defaultVariables 一处配置全局生效。
  //
  // ⚠️ 顺序依赖：main.tsx 里 `await initSiteMarketConfig()` 必须在 `import('@/i18n')`
  // 之前，本模块初始化时品牌才已就位。调换顺序会让所有文案回落到默认站名，
  // 且不报错、只是显示成 BETOGO —— 包网客户站上就是事故。
  interpolation: { escapeValue: false, defaultVariables: { brandName: getSiteName() } },
})

/**
 * 租户文案覆盖（P1-11）。在资源装好之后逐条盖上去。
 *
 * 用 `addResource` 而不是把 patch 深合并进 resources：点号键的嵌套由 i18next 自己处理，
 * 我们不必再写一遍 `checkin.title` → `{checkin:{title}}` 的还原逻辑。
 *
 * 覆盖不存在的 key 是无害的 —— 只是多一个没人读的词条。因此这里不校验 key
 * 是否在默认词表里：后台加了新 key、前端还没发版的过渡期不该报错。
 */
for (const [locale, entries] of Object.entries(getI18nOverrides())) {
  for (const [keyPath, value] of Object.entries(entries)) {
    i18n.addResource(locale, 'translation', keyPath, value)
  }
}

export function setAppLocale(locale: SupportedLocale) {
  void i18n.changeLanguage(locale)
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
}

export function getAppLocale(): SupportedLocale {
  const current = i18n.language
  return isSupportedLocale(current) ? current : 'en'
}
