import { useEffect, useRef, useState } from 'react'
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

// 数据驱动角标：优先级 万倍 > NEW > 高返，单张卡只显示一个，避免拥挤
function dataBadge(game: SlotGame): { text: string; cls: string } | null {
  const maxWin = game.maxWinMultiplier ?? 0
  if (maxWin >= 1000) return { text: `${maxWin >= 100000 ? '100K' : maxWin.toLocaleString()}x`, cls: 'bg-amber-500' }
  const rd = game.releaseDate ? new Date(game.releaseDate).getTime() : 0
  if (rd && Date.now() - rd < 90 * 864e5) return { text: 'NEW', cls: 'bg-blue-500' }
  if (game.phBonus >= 15) return { text: `+${Math.round(game.phBonus)}%`, cls: 'bg-red-500' }
  return null
}

// casinoplus 风格纯图卡：大卡=3列网格自适应宽 + 图下白色游戏名；小卡=固定 76×95 纯图横滑
export default function GameCardV2({ game, onTap, size, showLive }: Props) {
  const locale = useLocaleStore((s) => s.locale)
  const unavailable = game.supportsActiveCurrency === false
  const badge = dataBadge(game)
  // 封面裁剪版本：封面图走 immutable 长缓存，重裁同名图后需 bump 才能让客户端拿到新图
  const bust = (u: string | null | undefined) =>
    u && u.includes('/covers/') ? `${u}${u.includes('?') ? '&' : '?'}cv=3` : (u ?? null)
  const imageUrl = bust(game.imageHqUrl ?? game.imageUrl)
  // 封面一律 object-cover 居中裁切填满方卡：横图(真人厂商banner等)按中心裁成方形，与全站方图统一、
  // 无上下留白。焦点基本居中故裁切损失小；个别边缘内容被切的用后台换图弹窗指定方图。

  // 动图懒加载：首屏只加载静态首帧(imageUrl)；卡片进视口后后台预载动图(imageAnim)，
  // 加载完成才切换 src 播放，避免动图拖慢首屏（对齐 ptgaming 原始"首图先行、就绪后连播"逻辑）
  const wrapRef = useRef<HTMLDivElement>(null)
  const [animSrc, setAnimSrc] = useState<string | null>(null)
  useEffect(() => {
    const anim = bust(game.imageAnim)
    if (!anim || !imageUrl) return
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      const pre = new Image()
      pre.onload = () => setAnimSrc(anim)
      pre.src = anim
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [game.imageAnim, imageUrl])

  const displaySrc = animSrc ?? imageUrl
  // 全站封面统一：满幅同尺寸 + 圆角12px，无金边框。
  const image = (
    <div ref={wrapRef} className={`relative overflow-hidden rounded-xl bg-secondary ${size === 'lg' ? 'w-full aspect-square' : 'w-[76px] h-[76px]'}`}>
      {imageUrl ? (
        <img src={displaySrc ?? undefined} alt="" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-1.5">
          <span className="text-[10px] font-bold text-foreground/60 text-center leading-tight line-clamp-3">{localizedGameName(game, locale)}</span>
        </div>
      )}
      {badge && (
        <div className={`absolute top-1 right-1 rounded-full px-1.5 py-0.5 ${badge.cls}`}>
          <span className="text-white text-[9px] font-bold leading-none">{badge.text}</span>
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
