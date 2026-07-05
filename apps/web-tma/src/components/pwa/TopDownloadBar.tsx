import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, CloudDownload } from 'lucide-react'
import { usePromotionStore } from '@/stores/promotion'

/** 顶部下载条（JL6 式）：图标 + 文案 + Install 按钮，X 关闭仅当次会话生效；下载礼金活动开启时文案换成礼金宣传 */
export default function TopDownloadBar({ onInstall, onDismiss }: { onInstall: () => void; onDismiss: () => void }) {
  const { t } = useTranslation()
  const promoConfig = usePromotionStore((s) => s.promoConfig)
  const loadPromoConfig = usePromotionStore((s) => s.loadPromoConfig)

  useEffect(() => { void loadPromoConfig() }, [loadPromoConfig])

  const appdl = promoConfig?.appdl
  const desc = appdl?.enabled ? t('pwa.barPromo', { amount: appdl.amount }) : t('pwa.barDesc')

  return (
    <div className="relative flex items-center gap-2.5 border-b border-white/10 bg-gradient-to-r from-[#1a1206] via-[#241806] to-[#1a1206] px-2 py-2">
      <button
        type="button"
        aria-label="close"
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground active:scale-95"
        onClick={onDismiss}
      >
        <X size={15} />
      </button>

      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 flex-shrink-0 rounded-xl shadow-md shadow-black/50" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-black leading-tight text-foreground">{t('pwa.barTitle')}</p>
        <p className="truncate text-[11px] font-semibold leading-tight text-primary">{desc}</p>
      </div>

      <button
        type="button"
        className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-lg shadow-amber-500/30 active:scale-95 transition-transform"
        onClick={onInstall}
      >
        <CloudDownload size={15} />
        {t('pwa.barInstall')}
      </button>
    </div>
  )
}
