import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Star, Download, Zap, Maximize, Rocket, Share, SquarePlus, CheckCircle2 } from 'lucide-react'
import {
  canNativeInstall,
  isIos,
  isStandalone,
  onPwaStateChange,
  promptNativeInstall,
} from '@/utils/pwa'

// APK 上线后填入下载地址（如 /app/betogo.apk），空串 = 显示"即将上线"
const APK_DOWNLOAD_URL = ''

const STATS = { rating: '4.9', downloads: '1M+', age: '21+' }

export default function DownloadPage({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [, forceRender] = useState(0)

  useEffect(() => onPwaStateChange(() => forceRender((n) => n + 1)), [])

  const standalone = isStandalone()
  const nativeReady = canNativeInstall()
  const ios = isIos()

  const whyItems = [
    { icon: Zap, title: t('pwa.dl.why1Title'), desc: t('pwa.dl.why1Desc') },
    { icon: Maximize, title: t('pwa.dl.why2Title'), desc: t('pwa.dl.why2Desc') },
    { icon: Rocket, title: t('pwa.dl.why3Title'), desc: t('pwa.dl.why3Desc') },
  ]

  const iosSteps = [
    { icon: Share, text: t('pwa.iosStep1') },
    { icon: SquarePlus, text: t('pwa.iosStep2') },
    { icon: CheckCircle2, text: t('pwa.iosStep3') },
  ]

  const androidSteps = [t('pwa.dl.androidStep1'), t('pwa.dl.androidStep2'), t('pwa.dl.androidStep3')]

  return (
    <div className="min-h-dvh bg-background pb-10">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95 transition-transform"
          onClick={onClose}
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-base font-black text-foreground">{t('pwa.dl.title')}</h1>
      </div>

      {/* Hero */}
      <div className="mx-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <img src="/icons/icon-192.png" alt="BETOGO" className="h-20 w-20 rounded-2xl shadow-lg shadow-black/40" />
          <div className="min-w-0">
            <p className="text-2xl font-black tracking-tight text-foreground">BETOGO</p>
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">{t('pwa.dl.tagline')}</p>
            <div className="mt-1.5 flex items-center gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={13} className="fill-primary text-primary" />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-xl bg-secondary/60 py-3 text-center">
          <div>
            <p className="text-base font-black text-foreground">{STATS.rating}</p>
            <p className="text-[10px] font-semibold text-muted-foreground">{t('pwa.dl.rating')}</p>
          </div>
          <div>
            <p className="text-base font-black text-foreground">{STATS.downloads}</p>
            <p className="text-[10px] font-semibold text-muted-foreground">{t('pwa.dl.downloads')}</p>
          </div>
          <div>
            <p className="text-base font-black text-foreground">{STATS.age}</p>
            <p className="text-[10px] font-semibold text-muted-foreground">{t('pwa.dl.age')}</p>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          {APK_DOWNLOAD_URL ? (
            <a
              href={APK_DOWNLOAD_URL}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/30 transition-colors hover:bg-yellow-400"
              download
            >
              <Download size={17} />
              {t('pwa.dl.androidCta')}
            </a>
          ) : (
            <p className="rounded-xl border border-dashed border-border py-2.5 text-center text-[11px] font-semibold text-muted-foreground">
              {t('pwa.dl.androidComingSoon')}
            </p>
          )}

          {standalone ? (
            <p className="flex items-center justify-center gap-1.5 rounded-xl bg-secondary py-3 text-xs font-bold text-muted-foreground">
              <CheckCircle2 size={15} className="text-primary" />
              {t('pwa.dl.pwaInstalled')}
            </p>
          ) : nativeReady ? (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/30 transition-colors hover:bg-yellow-400"
              onClick={() => void promptNativeInstall()}
            >
              <SquarePlus size={17} />
              {t('pwa.dl.pwaCta')}
            </button>
          ) : null}
        </div>
      </div>

      {/* Why install */}
      <div className="mx-4 mt-5">
        <p className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">{t('pwa.dl.whyTitle')}</p>
        <div className="grid grid-cols-3 gap-2">
          {whyItems.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-3">
              <Icon size={18} className="text-primary" />
              <p className="mt-1.5 text-[11px] font-black leading-tight text-foreground">{title}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* iOS steps */}
      <div className="mx-4 mt-5 rounded-2xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-black uppercase tracking-wider text-muted-foreground">{t('pwa.dl.iosStepsTitle')}</p>
        <div className="space-y-3">
          {iosSteps.map(({ icon: Icon, text }, i) => (
            <div key={text} className="flex items-center gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-black text-primary">{i + 1}</span>
              <Icon size={16} className="flex-shrink-0 text-primary" />
              <p className="text-xs font-semibold text-foreground">{text}</p>
            </div>
          ))}
        </div>
        {ios && !standalone && (
          <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            {t('pwa.dl.openInSafariHint')}
          </p>
        )}
      </div>

      {/* Android steps */}
      <div className="mx-4 mt-4 rounded-2xl border border-border bg-card p-4">
        <p className="mb-3 text-xs font-black uppercase tracking-wider text-muted-foreground">{t('pwa.dl.androidStepsTitle')}</p>
        <div className="space-y-3">
          {androidSteps.map((text, i) => (
            <div key={text} className="flex items-center gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-black text-primary">{i + 1}</span>
              <p className="text-xs font-semibold text-foreground">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
