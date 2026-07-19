import { useEffect, useRef, useState } from 'react'
import type { SlotGame } from '@/api/slots'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'
import { shortProviderName } from '@/utils/providers'
import cashbackBadge2 from '@/assets/home/promos/cashback-badge-2.webp'
import cashbackBadge15 from '@/assets/home/promos/cashback-badge-1_5.webp'
import cashbackBadge1 from '@/assets/home/promos/cashback-badge-1.webp'

const CASHBACK_BADGE: Record<'elite' | 'pro' | 'basic', string> = {
  elite: cashbackBadge2,
  pro: cashbackBadge15,
  basic: cashbackBadge1,
}

interface Props {
  game: SlotGame
  onTap: () => void
  size: 'lg' | 'sm'
  showHot?: boolean
  showLive?: boolean
  goldBorder?: boolean
}

// casinoplus 风格纯图卡：大卡=3列网格自适应宽 + 图下白色游戏名；小卡=固定 76×95 纯图横滑
export default function GameCardV2({ game, onTap, size, showLive, goldBorder }: Props) {
  const locale = useLocaleStore((s) => s.locale)
  const unavailable = game.supportsActiveCurrency === false
  // 封面裁剪版本：封面图走 immutable 长缓存，重裁同名图后需 bump 才能让客户端拿到新图
  const bust = (u: string | null | undefined) =>
    u && u.includes('/covers/') ? `${u}${u.includes('?') ? '&' : '?'}cv=5` : (u ?? null)
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
  // 全站封面统一：满幅同尺寸 + 圆角12px；推荐位(goldBorder)外包 2px 金色渐变描边,
  // 小卡内图缩到 72px 保持 76px 总占位不挤乱横滑行
  const image = (
    <div ref={wrapRef} className={`relative overflow-hidden bg-secondary ${goldBorder ? 'rounded-[10px]' : 'rounded-xl'} ${size === 'lg' ? 'w-full aspect-square' : goldBorder ? 'w-[72px] h-[72px]' : 'w-[76px] h-[76px]'}`}>
      {imageUrl ? (
        <img src={displaySrc ?? undefined} alt="" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-1.5">
          <span className="text-[10px] font-bold text-foreground/60 text-center leading-tight line-clamp-3">{localizedGameName(game, locale)}</span>
        </div>
      )}
      {game.provider && (
        <span className={`absolute top-1 right-1 rounded-md bg-black/60 font-bold leading-tight text-white/90 pointer-events-none ${size === 'lg' ? 'px-1.5 py-0.5 text-[12px]' : 'px-1 py-px text-[8px]'}`}>
          {shortProviderName(game.provider)}
        </span>
      )}
      {/* Cashback 精选角标：三档奖牌徽标图(2%/1.5%/1%)贴左上角；与 LIVE 同占位,LIVE 优先。徽标含浮动金币,
          图本身带透明留白,故贴到 top-0/left-0 视觉即有内缩。宽度随卡片尺寸自适应 */}
      {game.cashbackTier && !showLive && (
        <img
          src={CASHBACK_BADGE[game.cashbackTier]}
          alt=""
          draggable={false}
          className={`absolute top-0 left-0 pointer-events-none ${size === 'lg' ? 'w-[37%]' : 'w-[52%]'}`}
        />
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

  // 推荐位金边：2px 渐变描边(上浅金→下深金),内图圆角略收与描边贴合
  const card = goldBorder ? (
    <div className="rounded-xl p-[2px] bg-gradient-to-b from-[#ffe27a] via-[#f0b437] to-[#b97e14]">
      {image}
    </div>
  ) : image

  if (size === 'sm') {
    return (
      <button
        type="button"
        className={`flex-shrink-0 active:scale-95 transition-transform ${unavailable ? 'opacity-55 grayscale' : ''}`}
        disabled={unavailable}
        onClick={onTap}
      >
        {card}
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
      {card}
      <p className="w-full px-0.5 text-[12px] font-semibold leading-tight text-white text-center truncate">
        {localizedGameName(game, locale)}
      </p>
    </button>
  )
}
