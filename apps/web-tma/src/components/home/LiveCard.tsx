import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props { game: SlotGame; onTap: () => void }

export default function LiveCard({ game, onTap }: Props) {
  const locale = useLocaleStore((s) => s.locale)
  return (
    <button
      type="button"
      className="flex-shrink-0 w-32 h-44 rounded-xl overflow-hidden active:scale-95 transition-transform"
      onClick={onTap}
    >
      <GameImageCard
        variant="mirror"
        imageUrl={game.imageHqUrl ?? game.imageUrl}
        fallbackBg={['#064e3b', '#065f46']}
        name={localizedGameName(game, locale)}
        provider={game.provider}
      >
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-red-500/85 rounded-full px-1.5 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-white text-[8px] font-bold">LIVE</span>
        </div>
      </GameImageCard>
    </button>
  )
}
