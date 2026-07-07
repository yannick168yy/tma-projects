import { createPortal } from 'react-dom'
import newPlayerImg from '@/assets/home/promos/new-player.webp'

interface Props {
  onClose: () => void
  onViewMore: () => void
}

// 居中弹出设计图（非铺满屏），X 与 VIEW MORE 已画在图里，只在其位置盖透明热区
export default function NewPlayerGiftSheet({ onClose, onViewMore }: Props) {
  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 px-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[400px]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={newPlayerImg}
          alt="New Player Gifts"
          draggable={false}
          className="block w-full max-h-[88dvh] select-none object-contain"
        />
        {/* 右上角 X：关闭弹窗 */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute cursor-pointer"
          style={{ top: '1%', right: '2%', width: '16%', height: '13%' }}
        />
        {/* 底部 VIEW MORE：进入优惠页 */}
        <button
          type="button"
          aria-label="View more"
          onClick={onViewMore}
          className="absolute cursor-pointer"
          style={{ left: '8%', right: '8%', top: '84%', height: '10%' }}
        />
      </div>
    </div>,
    document.body,
  )
}
