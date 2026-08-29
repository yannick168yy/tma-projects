import { create } from 'zustand'
import { setAppLocale, getAppLocale } from '@/i18n'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n/types'
import { updateUserLanguage } from '@/api/auth'
import { getToken } from '@/utils/tokenStore'

interface LocaleState {
  locale: SupportedLocale
}

interface LocaleActions {
  setLocale: (code: SupportedLocale) => void
}

export const useLocaleStore = create<LocaleState & LocaleActions>((set) => ({
  locale: getAppLocale(),

  setLocale(code) {
    if (!SUPPORTED_LOCALES.includes(code)) return
    set({ locale: code })
    setAppLocale(code)
    if (getToken()) void updateUserLanguage(code).catch(() => {})
  },
}))
