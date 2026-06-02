import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props { game: SlotGame; onTap: () => void }

export default function EGameCard({ game, onTap }: Props) {
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
        fallbackBg={['#1e1b4b', '#312e81']}
        name={localizedGameName(game, locale)}
        provider={game.provider}
      />
    </button>
  )
}
