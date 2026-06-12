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
  return (
    <div className="group relative h-44 overflow-hidden rounded-xl">
      <GameImageCard
        imageUrl={game.imageHqUrl ?? game.imageUrl}
        fallbackBg={['#1e1b4b', '#312e81']}
        name={localizedGameName(game, locale)}
        provider={game.provider}
        tag={tag?.label}
        tagBg={tag?.bg}
        tagFg={tag?.fg}
      >
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 transition-opacity duration-200 ${launching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <button
            type="button"
            className="flex w-4/5 items-center justify-center gap-1.5 rounded-full bg-primary py-2 text-xs font-bold text-primary-foreground shadow-lg"
            disabled={launching}
            onClick={(e) => { e.stopPropagation(); onPlay(game.uuid) }}
          >
            <Play size={12} /> Play
          </button>
          {game.hasDemo && (
            <button
              type="button"
              className="flex w-4/5 items-center justify-center gap-1.5 rounded-full bg-white/20 py-1.5 text-xs font-semibold text-white hover:bg-white/30"
              disabled={launching}
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
