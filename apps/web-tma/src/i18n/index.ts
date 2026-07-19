import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/i18n/locales/en'
import id from '@/i18n/locales/id'
import vi from '@/i18n/locales/vi'
import zhCN from '@/i18n/locales/zh-CN'
import { isSupportedLocale, LOCALE_STORAGE_KEY, type SupportedLocale } from '@/i18n/types'

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
  return 'en'
}

export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  lng: readStoredLocale(),
  fallbackLng: 'en',
  resources: {
    en: { translation: en },
    id: { translation: id },
    vi: { translation: vi },
    'zh-CN': { translation: zhCN },
  },
  interpolation: { escapeValue: false },
})

export function setAppLocale(locale: SupportedLocale) {
  void i18n.changeLanguage(locale)
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
}

export function getAppLocale(): SupportedLocale {
  const current = i18n.language
  return isSupportedLocale(current) ? current : 'en'
}
