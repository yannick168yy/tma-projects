import { useTranslation } from 'react-i18next'
import { ChevronLeft, Fingerprint, ShieldCheck, WalletCards } from 'lucide-react'
import { useKycFlow } from '@/hooks/useKycFlow'
import KycFlowContent from '@/components/wallet/KycFlowContent'

export default function KycSettingPage({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const flow = useKycFlow(true)

  return (
    <div
      className="page-main min-h-full pb-24"
      style={{ background: 'radial-gradient(120% 70% at 50% 0%, rgba(255,184,0,0.20) 0%, rgba(255,184,0,0.06) 44%, transparent 72%), linear-gradient(180deg, #080b14 0%, #11100d 45%, #080b14 100%)' }}
    >
      <div className="px-4 pt-3">
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-black/25 text-primary" onClick={onClose}>
          <ChevronLeft size={18} />
        </button>

        <div className="mt-4 overflow-hidden rounded-3xl border border-primary/20 bg-card shadow-[0_18px_48px_rgba(0,0,0,0.42)]">
          <div className="relative overflow-hidden px-5 pb-5 pt-5">
            <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full border border-primary/20 bg-primary/10 blur-2xl" />
            <div className="relative flex items-start gap-4">
              <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/15 text-primary shadow-[0_0_24px_rgba(255,184,0,0.18)]">
                <Fingerprint size={28} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-3xl font-black leading-none text-white">{t('kyc.settingTitle')}</h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('kyc.settingSubtitle')}</p>
              </div>
            </div>

            <div className="relative mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-primary/15 bg-black/20 px-3 py-3">
                <ShieldCheck size={16} className="mb-2 text-primary" />
                <p className="text-[10px] font-black uppercase text-white/45">{t('kyc.stepDocument')}</p>
                <p className="mt-0.5 text-xs font-black text-amber-100">{t('kyc.required')}</p>
              </div>
              <div className="rounded-2xl border border-primary/15 bg-black/20 px-3 py-3">
                <WalletCards size={16} className="mb-2 text-primary" />
                <p className="text-[10px] font-black uppercase text-white/45">{t('wallet.withdraw')}</p>
                <p className="mt-0.5 text-xs font-black text-amber-100">{t('kyc.stepFace')}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-primary/10 bg-black/10 px-5 pb-5 pt-4">
            <KycFlowContent flow={flow} onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  )
}
