import { Flame } from 'lucide-react'
import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props { game: SlotGame; onTap: () => void }

export default function GameCard({ game, onTap }: Props) {
  const locale = useLocaleStore((s) => s.locale)
  return (
    <button
      type="button"
      className="relative w-full h-44 overflow-hidden rounded-xl flex flex-col active:scale-[0.98] transition-transform"
      onClick={onTap}
    >
      <GameImageCard
        variant="mirror"
        imageUrl={game.imageHqUrl ?? game.imageUrl}
        fallbackBg={['#1e1b4b', '#312e81']}
        name={localizedGameName(game, locale)}
        provider={game.provider}
        tagBg={game.phBonus >= 20 ? '#ef4444' : undefined}
      >
        {game.phBonus >= 20 && (
          <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5">
            <Flame size={9} className="text-white" />
            <span className="text-white text-[9px] font-bold">HOT</span>
          </div>
        )}
      </GameImageCard>
    </button>
  )
}
