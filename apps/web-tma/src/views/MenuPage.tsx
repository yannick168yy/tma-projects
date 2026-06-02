import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ChevronRight, ChevronDown, Flame, Headphones, CheckCircle2 } from 'lucide-react'
import { MENU_DATA, type MenuSubcat } from '@/data/menu'
import { LANGUAGES } from '@/data/languages'
import { useMenuLabels } from '@/hooks/useMenuLabels'
import { useLocaleStore } from '@/stores/locale'

export interface CategoryLobbyParams {
  title: string
  themes?: string[]
  gameStyles?: string[]
  playerTypes?: string[]
}

interface Props {
  onOpenSearch: () => void
  onOpenCs: () => void
  onOpenCategoryLobby: (params: CategoryLobbyParams) => void
}

export default function MenuPage({ onOpenSearch, onOpenCs, onOpenCategoryLobby }: Props) {
  const { t } = useTranslation()
  const { sectionLabel, subcatLabel } = useMenuLabels()
  const { locale, setLocale } = useLocaleStore()
  const [langOpen, setLangOpen] = useState(false)

  const currentLang = useMemo(() => LANGUAGES.find((l) => l.code === locale)!, [locale])

  function onSubcatTap(cat: MenuSubcat) {
    const params: CategoryLobbyParams = {
      title: subcatLabel(cat.id, cat.label),
      ...(cat.filterType === 'themes' ? { themes: cat.filterValues }
        : cat.filterType === 'gameStyles' ? { gameStyles: cat.filterValues }
        : { playerTypes: cat.filterValues }),
    }
    onOpenCategoryLobby(params)
  }

  return (
    <div className="page-main pb-4">
      <div className="px-4 pt-3 pb-2">
        <button
          type="button"
          className="w-full flex items-center gap-2.5 bg-secondary border border-border rounded-xl px-3.5 py-2.5 text-left"
          onClick={onOpenSearch}
        >
          <Search size={14} className="text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground/50 text-sm">{t('menu.searchPlaceholder')}</span>
        </button>
      </div>

      <div className="pt-3 pb-2">
        {MENU_DATA.map((section) => (
          <div key={section.id} className="mb-5">
            <div className="flex items-center gap-2.5 px-5 mb-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: section.dot, boxShadow: `0 0 6px ${section.dot}` }} />
              <span className="text-foreground font-black text-base tracking-tight font-display">
                {sectionLabel(section.id, section.label).toUpperCase()}
              </span>
              <span className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${section.dot}33, transparent)` }} />
            </div>
            <div className="space-y-1.5 px-4">
              {section.subcats.map((cat, idx) => (
                <button
                  key={cat.id}
                  type="button"
                  className="w-full flex items-center gap-3 py-2.5 px-3.5 rounded-2xl active:scale-[0.97] transition-all text-left"
                  style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent' }}
                  onClick={() => onSubcatTap(cat)}
                >
                  <div
                    className={`w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-sm flex-shrink-0 ${cat.gradient}`}
                    style={{ boxShadow: `0 2px 10px ${cat.color}40` }}
                  >
                    <span className="text-[17px]">{cat.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-foreground font-bold text-[13px] leading-none font-display">{subcatLabel(cat.id, cat.label)}</span>
                      {cat.hot && (
                        <span className="flex items-center gap-0.5 bg-red-500/15 text-red-400 text-[9px] font-black px-1.5 py-0.5 rounded-full">
                          <Flame size={7} />{t('common.hot')}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground/60 text-[11px] mt-0.5 block">{t('common.games', { count: cat.count })}</span>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground/40 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="px-4 mt-2">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" style={{ boxShadow: '0 0 6px #818cf8' }} />
            <span className="text-foreground font-black text-base tracking-tight font-display">{t('menu.language')}</span>
          </div>
          <button
            type="button"
            className="w-full flex items-center gap-3 py-3 px-3.5 rounded-2xl bg-white/4 text-left"
            onClick={() => setLangOpen(!langOpen)}
          >
            <span className="text-xl">{currentLang.flag}</span>
            <span className="flex-1 text-foreground font-bold text-sm">{t(`languages.${currentLang.code}`)}</span>
            <ChevronDown size={14} className={`text-muted-foreground transition-transform ${langOpen ? 'rotate-180' : ''}`} />
          </button>
          {langOpen && (
            <div className="mt-1.5 rounded-2xl overflow-hidden border border-border bg-card">
              {LANGUAGES.map((l, i) => (
                <button
                  key={l.code}
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary transition-colors ${i < LANGUAGES.length - 1 ? 'border-b border-border' : ''} ${locale === l.code ? 'bg-primary/8' : ''}`}
                  onClick={() => { setLocale(l.code as Parameters<typeof setLocale>[0]); setLangOpen(false) }}
                >
                  <span className="text-lg">{l.flag}</span>
                  <span className={`text-sm font-bold flex-1 ${locale === l.code ? 'text-primary' : 'text-foreground'}`}>{t(`languages.${l.code}`)}</span>
                  {locale === l.code && <CheckCircle2 size={13} className="text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 mt-4 mb-1">
          <button
            type="button"
            className="w-full flex items-center gap-3 py-3 px-3.5 rounded-2xl border border-emerald-900/30 bg-emerald-950/20"
            onClick={onOpenCs}
          >
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow shadow-amber-500/20">
              <Headphones size={16} className="text-primary-foreground" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-foreground font-bold text-sm leading-none">{t('menu.customerSupport')}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-emerald-400 text-[11px] font-semibold">{t('menu.live247')}</p>
              </div>
            </div>
            <ChevronRight size={14} className="text-muted-foreground/50" />
          </button>
        </div>
      </div>
    </div>
  )
}
