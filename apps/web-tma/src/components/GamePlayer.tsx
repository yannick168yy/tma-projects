import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'
import gameLoadingImg from '@/assets/game-loading.webp'

interface Props {
  url: string
  onClose: () => void
}

export default function GamePlayer({ url, onClose }: Props) {
  const { t } = useTranslation()
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // 进度条是演出：iframe 没有真实进度事件，首帧后缓动到 92%，加载完成整层卸载
  const [barStarted, setBarStarted] = useState(false)
  const isTMA = isInsideTelegram()
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  function expand() {
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
          className="absolute z-20 transition-all duration-300"
          style={{ top: 'max(env(safe-area-inset-top, 0px) + 10px, 18px)', left: '12px' }}
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
              onClick={onClose}
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
        onLoad={() => setIframeLoaded(true)}
      />
    </div>
  )
}
