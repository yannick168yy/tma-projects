import { createPortal } from 'react-dom'
import newPlayerImg from '@/assets/home/promos/new-player.webp'

interface Props {
  onClose: () => void
  onViewMore: () => void
}

// 整张设计图铺满屏，X 与 VIEW MORE 已画在图里，只在其位置盖透明热区
export default function NewPlayerGiftSheet({ onClose, onViewMore }: Props) {
  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-[#0a0a14]"
      onClick={onClose}
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img
          src={newPlayerImg}
          alt="New Player Gifts"
          draggable={false}
          className="block max-h-[100dvh] max-w-[100vw] select-none"
        />
        {/* 右上角 X：关闭弹窗 */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute cursor-pointer"
          style={{ top: '2.5%', right: '2.5%', width: '16%', height: '9%' }}
        />
        {/* 底部 VIEW MORE：进入优惠页 */}
        <button
          type="button"
          aria-label="View more"
          onClick={onViewMore}
          className="absolute cursor-pointer"
          style={{ left: '12%', right: '12%', top: '82%', height: '8%' }}
        />
      </div>
    </div>,
    document.body,
  )
}
