import { useTranslation } from 'react-i18next'
import { i18n as i18nInstance } from '@/i18n'

export function useMenuLabels() {
  const { t } = useTranslation()

  function sectionLabel(sectionId: string, fallback: string) {
    const key = `menu.sections.${sectionId}`
    return i18nInstance.exists(key) ? t(key) : fallback
  }

  function subcatLabel(subcatId: string, fallback: string) {
    const key = `menu.subcats.${subcatId}`
    return i18nInstance.exists(key) ? t(key) : fallback
  }

  return { sectionLabel, subcatLabel }
}
