import { createPortal } from 'react-dom'
import newPlayerImg from '@/assets/home/promos/new-player.webp'

interface Props {
  onClose: () => void
  onContinue: () => void
}

// 居中弹出设计图（透明边），X 与 CONTINUE 已画在图里，只在其位置盖透明热区
export default function NewPlayerGiftSheet({ onClose, onContinue }: Props) {
  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 px-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[380px]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={newPlayerImg}
          alt="New Player Gifts"
          draggable={false}
          className="block w-full max-h-[90dvh] select-none object-contain"
        />
        {/* 右上角 X：关闭弹窗 */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute cursor-pointer"
          style={{ top: '5%', right: '5%', width: '16%', height: '12%' }}
        />
        {/* 底部 CONTINUE：未登录→登录弹窗，已登录→优惠页 */}
        <button
          type="button"
          aria-label="Continue"
          onClick={onContinue}
          className="absolute cursor-pointer"
          style={{ left: '8%', right: '8%', top: '84%', height: '9%' }}
        />
      </div>
    </div>,
    document.body,
  )
}
