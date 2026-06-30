import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'

interface Props {
  url: string
  onClose: () => void
}

export default function GamePlayer({ url, onClose }: Props) {
  const { t } = useTranslation()
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isTMA = isInsideTelegram()
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function expand() {
    setExpanded(true)
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = setTimeout(() => setExpanded(false), 2500)
  }

  useEffect(() => {
    if (isTMA) {
      window.Telegram?.WebApp?.BackButton?.show()
      window.Telegram?.WebApp?.BackButton?.onClick(onClose)
    } else {
      expand()
    }
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
      if (isTMA) {
        window.Telegram?.WebApp?.BackButton?.hide()
        window.Telegram?.WebApp?.BackButton?.offClick(onClose)
      }
    }
  }, [isTMA, onClose])

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
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
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
          <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      <iframe
        src={url}
        className="flex-1 w-full border-none"
        allow="fullscreen; autoplay; camera; microphone"
        onLoad={() => setIframeLoaded(true)}
      />
    </div>
  )
}
