import { useState } from 'react'
import { Flame } from 'lucide-react'
import type { SlotGame } from '@/api/slots'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

interface Props {
  game: SlotGame
  onTap: () => void
  size: 'lg' | 'sm'
  showHot?: boolean
  showLive?: boolean
}

// casinoplus 风格纯图卡：大卡=3列网格自适应宽 + 图下白色游戏名；小卡=固定 76×95 纯图横滑
export default function GameCardV2({ game, onTap, size, showHot, showLive }: Props) {
  const locale = useLocaleStore((s) => s.locale)
  const unavailable = game.supportsActiveCurrency === false
  const imageUrl = game.imageHqUrl ?? game.imageUrl
  // 上游厂商封面比例混杂（JILI 310×190 横图、PG 1024² 方图…），竖卡 cover 会把横图裁掉大半：
  // 横图改用「模糊底 + contain 完整显示」，方/竖图仍走 cover
  // 宽高优先取后端探测好的数据（首帧即正确渲染无闪动），缺失时回退 onLoad 运行时检测
  const [isLandscape, setIsLandscape] = useState(
    game.imageWidth != null && game.imageHeight != null && game.imageWidth > game.imageHeight * 1.15,
  )

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    if (game.imageWidth != null && game.imageHeight != null) return
    const img = e.currentTarget
    if (img.naturalWidth > img.naturalHeight * 1.15) setIsLandscape(true)
  }

  const image = (
    <div className={`relative overflow-hidden rounded-xl bg-secondary ${size === 'lg' ? 'w-full aspect-square' : 'w-[76px] h-[76px]'}`}>
      {imageUrl ? (
        <>
          {isLandscape && (
            <img src={imageUrl} alt="" aria-hidden draggable={false} className="absolute inset-0 w-full h-full object-cover scale-125 blur-md brightness-[0.55]" />
          )}
          <img src={imageUrl} alt="" loading="lazy" draggable={false} onLoad={onImageLoad} className={`absolute inset-0 w-full h-full ${isLandscape ? 'object-contain' : 'object-cover'}`} />
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-1.5">
          <span className="text-[10px] font-bold text-foreground/60 text-center leading-tight line-clamp-3">{localizedGameName(game, locale)}</span>
        </div>
      )}
      {showHot && game.phBonus >= 20 && (
        <div className="absolute top-1 left-1 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5">
          <Flame size={9} className="text-white" />
          <span className="text-white text-[9px] font-bold">HOT</span>
        </div>
      )}
      {showLive && (
        <div className="absolute top-1 left-1 flex items-center gap-1 bg-red-500/85 rounded-full px-1.5 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-white text-[8px] font-bold">LIVE</span>
        </div>
      )}
      {unavailable && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white">Unavailable</span>
        </div>
      )}
    </div>
  )

  if (size === 'sm') {
    return (
      <button
        type="button"
        className={`flex-shrink-0 active:scale-95 transition-transform ${unavailable ? 'opacity-55 grayscale' : ''}`}
        disabled={unavailable}
        onClick={onTap}
      >
        {image}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`w-full flex flex-col gap-1.5 active:scale-95 transition-transform ${unavailable ? 'opacity-55 grayscale' : ''}`}
      disabled={unavailable}
      onClick={onTap}
    >
      {image}
      <p className="w-full px-0.5 text-[12px] font-semibold leading-tight text-white text-center truncate">
        {localizedGameName(game, locale)}
      </p>
    </button>
  )
}
