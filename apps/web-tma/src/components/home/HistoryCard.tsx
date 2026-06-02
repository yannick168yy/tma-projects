import type { GameHistoryItem } from '@/api/slots'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props { game: GameHistoryItem; onTap: () => void }

export default function HistoryCard({ game, onTap }: Props) {
  const locale = useLocaleStore((s) => s.locale)
  return (
    <button
      type="button"
      className="flex-shrink-0 w-24 rounded-xl overflow-hidden relative h-24 text-left"
      onClick={onTap}
    >
      {(game.imageHqUrl || game.imageUrl) ? (
        <div className="absolute inset-0">
          <img src={game.imageHqUrl || game.imageUrl || ''} alt={game.name} className="w-full h-full object-cover" loading="lazy" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-amber-800 via-amber-600 to-yellow-400" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
      <div className="absolute bottom-0 inset-x-0 p-2">
        <p className="text-white font-black text-[11px] leading-tight truncate font-display">{localizedGameName(game, locale)}</p>
        <p className="text-white/50 text-[9px] uppercase">{game.provider}</p>
      </div>
    </button>
  )
}
