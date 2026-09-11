import { createPortal } from 'react-dom'
import { Wallet, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** 钱包弹窗 chunk 下载期间的占位骨架，容器尺寸与 WalletModal 一致，落地时不跳版 */
export default function WalletModalSkeleton({ fullscreen = false }: { fullscreen?: boolean }) {
  const { t } = useTranslation()
  return createPortal(
    <>
      <div className={fullscreen ? 'fixed inset-0 z-50 bg-[#07111f]' : 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm'} />
      <div
        className={fullscreen
          ? 'fixed bottom-0 left-1/2 top-0 z-50 flex w-full max-w-[430px] flex-col border-x border-amber-300/10 bg-[#07111f]'
          : 'fixed bottom-0 left-1/2 z-50 flex w-full max-w-[430px] flex-col rounded-t-[1.8rem] border border-amber-300/10 bg-[#07111f] shadow-[0_-18px_70px_rgba(0,0,0,0.55)]'}
        style={fullscreen ? { transform: 'translateX(-50%)', paddingTop: 'var(--app-safe-top)' } : { height: '86vh', maxHeight: '86vh', transform: 'translateX(-50%)' }}
      >
        {!fullscreen && <div className="flex flex-shrink-0 justify-center pb-1 pt-3"><div className="h-1 w-11 rounded-full bg-white/20" /></div>}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5"><Wallet size={20} className="text-primary" /><span className="font-display text-lg font-black uppercase tracking-wide text-white">{t('wallet.title')}</span></div>
          <div className="h-10 w-10" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={26} className="animate-spin text-primary/70" />
        </div>
      </div>
    </>,
    document.body,
  )
}
