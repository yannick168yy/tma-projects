import { useEffect, useRef, useState } from 'react'

export interface HomeBanner { id: number; image: string; target: string }

/**
 * 首页 Banner 轮播（P3-1 从 HomeContent 拆出）。
 *
 * 手势与自动轮播的全部状态都收在这里：原来 7 个函数 + 2 个 ref + 1 个 effect 摊在
 * HomeContent 顶部，改一处轮播行为要在 800 行文件里来回翻。
 *
 * 手势自己实现而不是靠 CSS snap：snap 在安卓 WebView 上会与外层纵向滚动抢手势，
 * 表现为「想上下滑却把 banner 拖走了」。所以先判定主轴，只有横向才接管。
 */
export default function BannerCarousel({ banners, onTap }: {
  banners: HomeBanner[]
  onTap: (target: string) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const dragRef = useRef<{ startX: number; startY: number; startScroll: number; axis: 'x' | 'y' | null; lastX: number; lastT: number }>(
    { startX: 0, startY: 0, startScroll: 0, axis: null, lastX: 0, lastT: 0 })

  function onScroll() {
    const el = trackRef.current
    if (!el || el.clientWidth <= 0) return
    setActive(Math.max(0, Math.min(banners.length - 1, Math.round(el.scrollLeft / el.clientWidth))))
  }

  function scrollTo(index: number) {
    const el = trackRef.current
    if (!el) return
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' })
    setActive(index)
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    if (!t) return
    dragRef.current = {
      startX: t.clientX, startY: t.clientY, startScroll: trackRef.current?.scrollLeft ?? 0,
      axis: null, lastX: t.clientX, lastT: Date.now(),
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    const el = trackRef.current
    const touch = e.touches[0]
    if (!el || !touch) return
    const dx = touch.clientX - dragRef.current.startX
    const dy = touch.clientY - dragRef.current.startY
    if (dragRef.current.axis === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      dragRef.current.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    }
    if (dragRef.current.axis !== 'x') return
    e.preventDefault()
    el.scrollLeft = dragRef.current.startScroll - dx
    dragRef.current.lastX = touch.clientX
    dragRef.current.lastT = Date.now()
  }

  function onTouchEnd() {
    if (dragRef.current.axis === 'x') {
      const el = trackRef.current
      if (el && el.clientWidth > 0) {
        const dx = dragRef.current.startX - dragRef.current.lastX
        const velocity = dx / Math.max(1, Date.now() - dragRef.current.lastT)
        const threshold = el.clientWidth * 0.18
        const cur = active
        if (dx > threshold || velocity > 0.35) scrollTo(Math.min(banners.length - 1, cur + 1))
        else if (dx < -threshold || velocity < -0.35) scrollTo(Math.max(0, cur - 1))
        else el.scrollTo({ left: cur * el.clientWidth, behavior: 'smooth' })
      }
    }
    dragRef.current.axis = null
  }

  useEffect(() => {
    if (banners.length <= 1) return
    const id = setInterval(() => {
      setActive((cur) => {
        const next = (cur + 1) % banners.length
        const el = trackRef.current
        if (el && el.clientWidth > 0) el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
        return next
      })
    }, 3500)
    return () => clearInterval(id)
  }, [banners.length])

  if (banners.length === 0) return null

  return (
    <div className="px-4 mt-2">
      {/* 16:9 跟随屏宽自适应，固定高度在窄屏机会横向裁切图片 */}
      <div className="relative aspect-video overflow-hidden rounded-2xl">
        <div ref={trackRef} className="banner-carousel flex h-full snap-x snap-mandatory hide-scrollbar"
          onScroll={onScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          {banners.map((banner) => (
            <article key={banner.id} className="relative h-full w-full flex-shrink-0 snap-center"
              onClick={() => onTap(banner.target)}>
              <img src={banner.image} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
            </article>
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
          {banners.map((_, i) => (
            <button key={i} type="button"
              className={`pointer-events-auto h-1.5 rounded-full transition-all ${i === active ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`}
              onClick={() => scrollTo(i)} />
          ))}
        </div>
      </div>
    </div>
  )
}
