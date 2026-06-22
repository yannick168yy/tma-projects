import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { useKycFlow } from '@/hooks/useKycFlow'
import KycFlowContent from '@/components/wallet/KycFlowContent'

export default function KycSettingPage({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const flow = useKycFlow(true)

  return (
    <div className="page-main min-h-full pb-24">
      <div
        className="relative overflow-hidden px-4 pb-5 pt-3"
        style={{ background: 'linear-gradient(150deg, #1f1400 0%, #3a2700 48%, #18181b 100%)' }}
      >
        <button type="button" className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white" onClick={onClose}>
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-black text-white">{t('kyc.settingTitle')}</h1>
        <p className="mt-1 text-sm text-white/60">{t('kyc.settingSubtitle')}</p>
      </div>

      <div className="px-4 pt-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <KycFlowContent flow={flow} onClose={onClose} />
        </div>
      </div>
    </div>
  )
}
