import { useI18n } from 'vue-i18n'

/** Translate menu section / subcategory ids from MENU_DATA. */
export function useMenuLabels() {
  const { t, te } = useI18n()

  function sectionLabel(sectionId: string, fallback: string) {
    const key = `menu.sections.${sectionId}`
    return te(key) ? t(key) : fallback
  }

  function subcatLabel(subcatId: string, fallback: string) {
    const key = `menu.subcats.${subcatId}`
    return te(key) ? t(key) : fallback
  }

  return { sectionLabel, subcatLabel }
}
