import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useKycFlow } from '@/hooks/useKycFlow'
import KycFlowContent from '@/components/wallet/KycFlowContent'

interface Props {
  open: boolean
  onClose: () => void
  onApproved?: () => void
}

export default function KycModal({ open, onClose, onApproved }: Props) {
  const flow = useKycFlow(open, onApproved)

  // 人脸步骤全屏展示，方便用户自拍
  const fullScreenFace = flow.step === 'face'

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  if (fullScreenFace) {
    return createPortal(
      <div className="fixed inset-0 z-[95] flex flex-col overflow-y-auto bg-card p-6">
        <button type="button" className="absolute right-4 top-4 z-10 rounded-full p-1 text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X size={20} />
        </button>
        <div className="mx-auto w-full max-w-[480px]">
          <KycFlowContent flow={flow} onClose={onClose} />
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 max-h-[92vh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl border border-border bg-card p-6 shadow-2xl sm:rounded-3xl">
        <button type="button" className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X size={18} />
        </button>
        <KycFlowContent flow={flow} onClose={onClose} />
      </div>
    </div>,
    document.body,
  )
}
