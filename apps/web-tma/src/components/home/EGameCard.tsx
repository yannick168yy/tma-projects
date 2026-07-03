import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props { game: SlotGame; onTap: () => void; className?: string }

export default function EGameCard({ game, onTap, className }: Props) {
  const locale = useLocaleStore((s) => s.locale)
  const unavailable = game.supportsActiveCurrency === false
  return (
    <button
      type="button"
      className={`${className ?? 'flex-shrink-0 w-32 h-44 rounded-xl overflow-hidden active:scale-95 transition-transform'} ${unavailable ? 'opacity-55 grayscale' : ''}`}
      disabled={unavailable}
      onClick={onTap}
    >
      <GameImageCard
        variant="mirror"
        imageUrl={game.imageHqUrl ?? game.imageUrl}
        fallbackBg={['#1e1b4b', '#312e81']}
        name={localizedGameName(game, locale)}
        provider={game.provider}
      >
        {unavailable && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55">
            <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">Unavailable</span>
          </div>
        )}
      </GameImageCard>
    </button>
  )
}
