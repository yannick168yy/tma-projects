import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props { game: SlotGame; onTap: () => void }

export default function GameCard({ game, onTap }: Props) {
  const locale = useLocaleStore((s) => s.locale)
  const unavailable = game.supportsActiveCurrency === false
  return (
    <button
      type="button"
      className={`relative w-full h-44 overflow-hidden rounded-xl flex flex-col active:scale-[0.98] transition-transform ${unavailable ? 'opacity-55 grayscale' : ''}`}
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
