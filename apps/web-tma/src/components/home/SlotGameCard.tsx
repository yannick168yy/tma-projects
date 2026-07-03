import { Play, Tv2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard'
import { localizedThemeTag } from '@/utils/theme-tag'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props {
  game: SlotGame
  launching: boolean
  onPlay: (uuid: string) => void
  onDemo: (uuid: string) => void
}

export default function SlotGameCard({ game, launching, onPlay, onDemo }: Props) {
  const { t } = useTranslation()
  const locale = useLocaleStore((s) => s.locale)
  const tag = localizedThemeTag(game.theme, t)
  const unavailable = game.supportsActiveCurrency === false
  return (
    <div className={`group relative h-44 overflow-hidden rounded-xl ${unavailable ? 'opacity-55 grayscale' : ''}`}>
      <GameImageCard
        imageUrl={game.imageHqUrl ?? game.imageUrl}
        fallbackBg={['#1e1b4b', '#312e81']}
        name={localizedGameName(game, locale)}
        provider={game.provider}
        tag={tag?.label}
        tagBg={tag?.bg}
        tagFg={tag?.fg}
      >
        {unavailable && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55">
            <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">Unavailable</span>
          </div>
        )}
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 transition-opacity duration-200 ${launching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${unavailable ? 'pointer-events-none' : ''}`}>
          <button
            type="button"
            className="flex w-4/5 items-center justify-center gap-1.5 rounded-full bg-primary py-2 text-xs font-bold text-primary-foreground shadow-lg"
            disabled={launching || unavailable}
            onClick={(e) => { e.stopPropagation(); onPlay(game.uuid) }}
          >
            <Play size={12} /> Play
          </button>
          {game.hasDemo && (
            <button
              type="button"
              className="flex w-4/5 items-center justify-center gap-1.5 rounded-full bg-white/20 py-1.5 text-xs font-semibold text-white hover:bg-white/30"
              disabled={launching || unavailable}
              onClick={(e) => { e.stopPropagation(); onDemo(game.uuid) }}
            >
              <Tv2 size={11} /> Demo
            </button>
          )}
        </div>
      </GameImageCard>
    </div>
  )
}
