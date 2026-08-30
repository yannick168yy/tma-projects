import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import newPlayerImg from '@/assets/home/promos/new-player.webp'
import { localizedImage } from '@/utils/localizedImage'

interface Props {
  onClose: () => void
  onContinue: () => void
}

// 居中弹出设计图（透明边），X 与 CONTINUE 画在图里、盖透明热区。
// 弱网防卡死：图未加载时用固定宽高比占位 + loading 圈 + 独立兜底关闭按钮，
// 保证遮罩出现时用户始终能关闭，不会被空遮罩挡死。
export default function NewPlayerGiftSheet({ onClose, onContinue }: Props) {
  const [loaded, setLoaded] = useState(false)
  const { i18n } = useTranslation()
  const isIndonesian = i18n.language.toLowerCase().startsWith('id')
  const imageUrl = localizedImage(newPlayerImg, i18n.language, 'new-player.webp')

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 px-4"
      onClick={onClose}
    >
      {/* 兜底关闭：仅在图未加载时显示，图片自带的 X 出来后隐藏，避免双 X */}
      {!loaded && (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white/90 active:scale-95"
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      )}

      <div
        className="relative w-full"
        style={{ maxWidth: isIndonesian ? 'min(380px, calc((100vh - 32px) * 864 / 1821))' : '380px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 固定宽高比占位：图未到也先撑开正确尺寸，热区坐标稳定、布局不跳 */}
        <div className="relative w-full" style={{ aspectRatio: isIndonesian ? '864 / 1821' : '1024 / 1536' }}>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white/90" />
            </div>
          )}
          <img
            src={imageUrl}
            alt={isIndonesian ? 'Hadiah Pemain Baru' : 'New Player Gifts'}
            draggable={false}
            onLoad={() => setLoaded(true)}
            className={`block h-full w-full select-none object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
          {/* 图内热区仅在加载完成后启用（此前用兜底 X） */}
          {loaded && (
            <>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="absolute cursor-pointer"
                style={{ top: '5%', right: '5%', width: '16%', height: '12%' }}
              />
              <button
                type="button"
                aria-label="Continue"
                onClick={onContinue}
                className="absolute cursor-pointer"
                style={{ left: '21%', right: '21%', top: '89.5%', height: '7.5%' }}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
