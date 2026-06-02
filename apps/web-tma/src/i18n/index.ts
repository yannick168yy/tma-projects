import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/i18n/locales/en'
import id from '@/i18n/locales/id'
import vi from '@/i18n/locales/vi'
import zhCN from '@/i18n/locales/zh-CN'
import { isSupportedLocale, LOCALE_STORAGE_KEY, type SupportedLocale } from '@/i18n/types'

function readStoredLocale(): SupportedLocale {
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
