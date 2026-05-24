import { defineStore } from 'pinia'
import { getAppLocale, setAppLocale } from '@/i18n'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n/types'

export const useLocaleStore = defineStore('locale', {
  state: () => ({
    locale: getAppLocale() as SupportedLocale,
  }),

  actions: {
    setLocale(code: SupportedLocale) {
      if (!SUPPORTED_LOCALES.includes(code)) return
      this.locale = code
      setAppLocale(code)
    },
  },
})
