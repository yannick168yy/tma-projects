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
}

// casinoplus 风格纯图卡：大卡=3列网格自适应宽 + 图下白色游戏名；小卡=固定 76×95 纯图横滑
export default function GameCardV2({ game, onTap, size, showLive }: Props) {
  // 大卡统一加细金边(全站所有页面),小卡横滑不加
  const goldBorder = size === 'lg'
  const locale = useLocaleStore((s) => s.locale)
  // 不可用 = 不支持当前币种 或 上游维护/下线(isAvailable=false)：都灰化+禁点，仅遮罩文案不同
  const currencyUnsupported = game.supportsActiveCurrency === false
  const maintaining = game.isAvailable === false
  const unavailable = currencyUnsupported || maintaining
  // 封面裁剪版本：封面图走 immutable 长缓存，重裁同名图后需 bump 才能让客户端拿到新图
  const bust = (u: string | null | undefined) =>
    u && u.includes('/covers/') ? `${u}${u.includes('?') ? '&' : '?'}cv=6` : (u ?? null)
  const imageUrl = bust(game.imageHqUrl ?? game.imageUrl)
  // 封面一律 object-cover 居中裁切填满方卡：横图(真人厂商banner等)按中心裁成方形，与全站方图统一、
  // 无上下留白。焦点基本居中故裁切损失小；个别边缘内容被切的用后台换图弹窗指定方图。

  // 真懒加载：卡片接近视口(300px)才开始加载封面。原生 loading=lazy 在横滑行里基本失效——
  // 会把整行离屏图全下载,是首屏图片过重的主因；改用 IntersectionObserver 精确门控。
  const wrapRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [animSrc, setAnimSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      setInView(true)
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // 动图不占首屏：卡片入视口且浏览器空闲后再预载动图(imageAnim)，就绪才切 src 连播，
  // 使首屏只承载静态封面（对齐 ptgaming"首图先行、就绪后连播"，且不与首屏渲染争带宽）
  useEffect(() => {
    if (!inView) return
    const anim = bust(game.imageAnim)
    if (!anim || !imageUrl) return
    const idle = (cb: () => void): number =>
      typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 1500 }) : window.setTimeout(cb, 600)
    const handle = idle(() => {
      const pre = new Image()
      pre.onload = () => setAnimSrc(anim)
      pre.src = anim
    })
    return () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [inView, game.imageAnim, imageUrl])

  const displaySrc = inView ? (animSrc ?? imageUrl) : null
  // 全站封面统一：满幅同尺寸 + 圆角12px；大卡在容器上画 1px 金色 border——
  // overflow-hidden 把子元素(含 iOS 动图独立合成层)裁在 padding 盒内碰不到边框区,
  // 且边框与容器同层无独立像素取整,规避了内衬包裹/mask 环/提层环三种画法的 iOS 跑版坑
  const image = (
    <div ref={wrapRef} className={`relative overflow-hidden bg-secondary rounded-xl ${goldBorder ? 'border border-[#f0b437]' : ''} ${size === 'lg' ? 'w-full aspect-square' : 'w-[76px] h-[76px]'}`}>
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
      {/* 左上角 Cashback 精选角标；与 LIVE 同占位,LIVE 优先。徽标图本身带透明留白,故贴到 top-0/left-0 视觉即有内缩,宽度随卡片尺寸自适应 */}
      {!showLive && game.cashbackTier && (
        <div className={`absolute top-0 left-0 flex flex-col pointer-events-none ${size === 'lg' ? 'w-[37%]' : 'w-[52%]'}`}>
          <img src={CASHBACK_BADGE[game.cashbackTier]} alt="" draggable={false} className="w-full" />
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
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white">{maintaining ? 'Maintenance' : 'Unavailable'}</span>
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
