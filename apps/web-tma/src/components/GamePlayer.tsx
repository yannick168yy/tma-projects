import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'
import gameLoadingImg from '@/assets/game-loading.webp'

interface Props {
  url: string
  onClose: () => void
}

// 宣传图最短展示时长：秒开的游戏也让促销信息停留可读，同时盖住 iframe
// onLoad 到游戏真正渲染之间的衔接段
const MIN_LOADING_MS = 2000

export default function GamePlayer({ url, onClose }: Props) {
  const { t } = useTranslation()
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const shownAt = useRef(Date.now())
  const [expanded, setExpanded] = useState(false)
  // 进度条是演出：iframe 没有真实进度事件，首帧后缓动到 92%，加载完成整层卸载
  const [barStarted, setBarStarted] = useState(false)
  const isTMA = isInsideTelegram()
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // 返回按钮可拖拽：pos 为 null 时用默认左上角定位，一旦拖动改为受控 left/top
  const btnRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)

  function onBtnPointerDown(e: React.PointerEvent) {
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    dragState.current = { startX: e.clientX, startY: e.clientY, baseX: rect.left, baseY: rect.top, moved: false }
    justDragged.current = false
    btnRef.current?.setPointerCapture(e.pointerId)
    e.stopPropagation()
  }

  function onBtnPointerMove(e: React.PointerEvent) {
    const st = dragState.current
    if (!st) return
    const dx = e.clientX - st.startX
    const dy = e.clientY - st.startY
    // 超过阈值才算拖动，避免点按时的微小抖动被误判
    if (!st.moved && Math.hypot(dx, dy) < 4) return
    st.moved = true
    justDragged.current = true
    const rect = btnRef.current?.getBoundingClientRect()
    const w = rect?.width ?? 36
    const h = rect?.height ?? 36
    const nx = Math.min(Math.max(st.baseX + dx, 4), window.innerWidth - w - 4)
    const ny = Math.min(Math.max(st.baseY + dy, 4), window.innerHeight - h - 4)
    setPos({ x: nx, y: ny })
  }

  function onBtnPointerUp(e: React.PointerEvent) {
    const st = dragState.current
    dragState.current = null
    btnRef.current?.releasePointerCapture(e.pointerId)
    // 拖动过就吞掉紧随其后的 click，避免误触展开/退出游戏
    if (st?.moved) setTimeout(() => { justDragged.current = false }, 0)
  }

  function expand() {
    if (justDragged.current) return
    setExpanded(true)
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = setTimeout(() => setExpanded(false), 2500)
  }

  // iOS Safari 不支持任意元素全屏，会抛异常静默降级；Android Chrome 可进真全屏
  function enterFullscreen() {
    const el = rootRef.current as any
    if (!el || document.fullscreenElement || (document as any).webkitFullscreenElement) return
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen
    if (req) {
      try { req.call(el) } catch { /* 不支持则维持铺满视口的伪全屏 */ }
    }
  }

  function exitFullscreen() {
    const d = document as any
    if (!d.fullscreenElement && !d.webkitFullscreenElement) return
    const ex = d.exitFullscreen || d.webkitExitFullscreen
    if (ex) {
      try { ex.call(d) } catch { /* noop */ }
    }
  }

  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarStarted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (isTMA) {
      window.Telegram?.WebApp?.BackButton?.show()
      window.Telegram?.WebApp?.BackButton?.onClick(onClose)
    } else {
      expand()
      // 拉游戏 URL 的 await 已断开用户手势，这里可能被拒，故另有首次交互兜底
      enterFullscreen()
    }
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
      if (isTMA) {
        window.Telegram?.WebApp?.BackButton?.hide()
        window.Telegram?.WebApp?.BackButton?.offClick(onClose)
      } else {
        exitFullscreen()
      }
    }
  }, [isTMA, onClose])

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      onPointerDown={!isTMA ? enterFullscreen : undefined}
    >
      {!isTMA && (
        <div
          ref={btnRef}
          className="absolute z-20 cursor-grab active:cursor-grabbing"
          style={{
            ...(pos
              ? { top: `${pos.y}px`, left: `${pos.x}px` }
              : { top: 'max(env(safe-area-inset-top, 0px) + 10px, 18px)', left: '12px' }),
            touchAction: 'none',
          }}
          onPointerDown={onBtnPointerDown}
          onPointerMove={onBtnPointerMove}
          onPointerUp={onBtnPointerUp}
        >
          {!expanded ? (
            <button
              type="button"
              className="flex items-center justify-center w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 text-white active:bg-black/70 transition-colors"
              onClick={expand}
            >
              <ArrowLeft size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 px-4 py-2 text-sm font-bold text-white active:bg-black/80 transition-colors"
              onClick={() => { if (!justDragged.current) onClose() }}
            >
              <ArrowLeft size={15} />
              {t('game.backToBetoGo')}
            </button>
          )}
        </div>
      )}

      {!iframeLoaded && (
        <div className="absolute inset-0 z-10 bg-[#080b14]">
          <img
            src={gameLoadingImg}
            alt=""
            draggable={false}
            className="w-full h-full object-cover object-top select-none"
          />
          <div
            className="absolute inset-x-0 flex flex-col items-center gap-2"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)' }}
          >
            <div className="w-2/3 max-w-[280px] h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-300"
                style={{
                  width: barStarted ? '92%' : '4%',
                  transition: 'width 7s cubic-bezier(0.08, 0.62, 0.23, 0.98)',
                }}
              />
            </div>
            <span className="text-[11px] font-medium text-white/70">{t('game.loading', 'Loading...')}</span>
          </div>
        </div>
      )}

      {/* 不给 iframe fullscreen 权限: 否则 Jili Super Ace 等游戏会把 iframe 单独全屏,
          令全屏元素只剩 iframe, 兄弟节点的返回按钮被盖住消失.
          全屏由外层 rootRef(含返回按钮)统一接管, 见 enterFullscreen. */}
      <iframe
        src={url}
        className="flex-1 w-full border-none"
        allow="autoplay; camera; microphone"
        onLoad={() => {
          const remain = MIN_LOADING_MS - (Date.now() - shownAt.current)
          if (remain > 0) setTimeout(() => setIframeLoaded(true), remain)
          else setIframeLoaded(true)
        }}
      />
    </div>
  )
}
