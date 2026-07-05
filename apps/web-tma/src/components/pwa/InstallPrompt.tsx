import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Share, SquarePlus, CheckCircle2 } from 'lucide-react'
import {
  isInstallPromptSnoozed,
  onPwaStateChange,
  promptNativeInstall,
  canNativeInstall,
  isIos,
  shouldOfferInstall,
  snoozeInstallPrompt,
} from '@/utils/pwa'

const SHOW_DELAY_MS = 8000

/** 浏览器访问时的「添加到主屏幕」引导条（TG 内 / 已安装 / 3 天内关闭过不显示） */
export default function InstallPrompt({ onOpenDownload }: { onOpenDownload: () => void }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [iosStepsOpen, setIosStepsOpen] = useState(false)
  const [, forceRender] = useState(0)

  useEffect(() => {
    if (isInstallPromptSnoozed()) return
    const timer = setTimeout(() => {
      if (shouldOfferInstall()) setVisible(true)
    }, SHOW_DELAY_MS)
    // beforeinstallprompt 可能晚于定时器触发，状态变化时再评估一次
    const unsub = onPwaStateChange(() => {
      forceRender((n) => n + 1)
      if (!isInstallPromptSnoozed() && shouldOfferInstall()) setVisible(true)
    })
    return () => { clearTimeout(timer); unsub() }
  }, [])

  if (!visible) return null

  function dismiss() {
    snoozeInstallPrompt()
    setVisible(false)
  }

  async function onInstallTap() {
    if (canNativeInstall()) {
      const outcome = await promptNativeInstall()
      if (outcome === 'accepted') setVisible(false)
      return
    }
    if (isIos()) {
      setIosStepsOpen(true)
      return
    }
    onOpenDownload()
  }

  const iosSteps = [
    { icon: Share, text: t('pwa.iosStep1') },
    { icon: SquarePlus, text: t('pwa.iosStep2') },
    { icon: CheckCircle2, text: t('pwa.iosStep3') },
  ]

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
      <div className="w-full max-w-[406px] rounded-2xl border border-border bg-card p-4 shadow-2xl shadow-black/60">
        <div className="flex items-start gap-3">
          <img src="/icons/icon-192.png" alt="" className="h-12 w-12 flex-shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-foreground">{t('pwa.promptTitle')}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('pwa.promptDesc')}</p>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
            onClick={dismiss}
          >
            <X size={14} />
          </button>
        </div>

        {iosStepsOpen && (
          <div className="mt-3 space-y-2.5 rounded-xl bg-secondary/60 p-3">
            {iosSteps.map(({ icon: Icon, text }, i) => (
              <div key={text} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-black text-primary">{i + 1}</span>
                <Icon size={14} className="flex-shrink-0 text-primary" />
                <p className="text-[11px] font-semibold text-foreground">{text}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-black text-primary-foreground shadow-lg shadow-amber-500/30 transition-colors hover:bg-yellow-400"
            onClick={() => void onInstallTap()}
          >
            {t('pwa.promptInstall')}
          </button>
          <button
            type="button"
            className="rounded-xl bg-secondary px-3 py-2.5 text-xs font-bold text-muted-foreground"
            onClick={() => { dismiss(); onOpenDownload() }}
          >
            {t('pwa.promptMore')}
          </button>
        </div>
      </div>
    </div>
  )
}
