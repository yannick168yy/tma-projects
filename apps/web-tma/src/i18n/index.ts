import { createI18n } from 'vue-i18n'
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

export const i18n = createI18n({
  legacy: false,
  locale: readStoredLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    id,
    vi,
    'zh-CN': zhCN,
  },
})

export function setAppLocale(locale: SupportedLocale) {
  i18n.global.locale.value = locale
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
}

export function getAppLocale(): SupportedLocale {
  const current = i18n.global.locale.value
  return isSupportedLocale(current) ? current : 'en'
}
