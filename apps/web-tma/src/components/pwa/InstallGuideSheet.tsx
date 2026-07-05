import { useTranslation } from 'react-i18next'
import {
  X,
  Share,
  SquarePlus,
  ChevronLeft,
  ChevronRight,
  Book,
  Star,
  Search,
  Copy,
  RotateCw,
  MoreVertical,
  Download,
} from 'lucide-react'

function StepBadge({ n }: { n: number }) {
  return (
    <span className="absolute -left-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-[#e02020] text-[11px] font-black text-white">
      {n}
    </span>
  )
}

/** 仿 iOS/安卓系统界面的 PWA 安装图文引导升窗（FBM Play 式） */
export default function InstallGuideSheet({
  platform,
  title,
  onClose,
}: {
  platform: 'ios' | 'android'
  title?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const host = window.location.host

  const ios = platform === 'ios'

  const menuRows = ios
    ? [
        { icon: Book, label: t('pwa.guide.addBookmark') },
        { icon: Star, label: t('pwa.guide.addFavorites') },
        { icon: Search, label: t('pwa.guide.findOnPage') },
      ]
    : [
        { icon: Star, label: t('pwa.guide.bookmarks') },
        { icon: Download, label: t('pwa.guide.downloads') },
        { icon: Copy, label: t('pwa.guide.recentTabs') },
      ]

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-[430px] max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-[#f2f2f7] pb-6 text-black" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <div className="sticky top-0 z-10 flex items-center justify-center bg-[#f2f2f7] px-4 pb-1 pt-4">
          <h2 className="text-xl font-bold">{title ?? t('pwa.guide.title')}</h2>
          <button
            type="button"
            aria-label="close"
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-black/60"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        {/* Step 1 */}
        <p className="mt-3 text-center text-[15px] font-bold text-[#e02020]">
          {ios ? t('pwa.guide.iosStep1') : t('pwa.guide.andStep1')}
        </p>
        <div className="mx-4 mt-2.5 rounded-2xl bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2 rounded-xl bg-[#e9e9ee] px-3 py-2.5">
            {ios && <span className="text-[13px] font-semibold text-black/70">AA</span>}
            <span className="flex-1 text-center text-[14px] font-semibold text-black/85">{host}</span>
            {ios ? (
              <RotateCw size={15} className="text-black/60" />
            ) : (
              <span className="relative">
                <span className="absolute -inset-1.5 rounded-full border-2 border-[#e02020]" />
                <StepBadge n={1} />
                <MoreVertical size={17} className="text-black/70" />
              </span>
            )}
          </div>
          {ios && (
            <div className="mt-2.5 flex items-center justify-around px-1 py-1">
              <ChevronLeft size={22} className="text-[#0a84ff]" />
              <ChevronRight size={22} className="text-[#c7c7cc]" />
              <span className="relative">
                <span className="absolute -inset-2 rounded-full border-2 border-[#e02020]" />
                <StepBadge n={1} />
                <Share size={22} className="text-[#0a84ff]" />
              </span>
              <Book size={22} className="text-[#0a84ff]" />
              <Copy size={22} className="text-[#0a84ff]" />
            </div>
          )}
        </div>

        {/* Step 2 */}
        <p className="mt-5 text-center text-[15px] font-bold text-[#e02020]">
          {ios ? t('pwa.guide.iosStep2') : t('pwa.guide.andStep2')}
        </p>
        <div className="mx-4 mt-2.5 rounded-2xl bg-white p-2 shadow-sm">
          {menuRows.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center justify-between border-b border-black/5 px-3 py-2.5">
              <span className="text-[14px] text-black/85">{label}</span>
              <Icon size={17} className="text-black/55" />
            </div>
          ))}
          <div className="relative mx-0.5 mt-1.5 flex items-center justify-between rounded-lg border-2 border-[#e02020] px-3 py-2.5">
            <StepBadge n={2} />
            <span className="text-[14px] font-semibold text-black/90">{t('pwa.guide.addToHome')}</span>
            <SquarePlus size={17} className="text-black/70" />
          </div>
        </div>

        {/* Step 3 */}
        <p className="mt-5 text-center text-[15px] font-bold text-[#e02020]">{t('pwa.guide.step3')}</p>
        <div className="mx-4 mt-2.5 rounded-2xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between px-1 pb-3 pt-1">
            <span className="text-[14px] text-[#0a84ff]">{t('pwa.guide.cancel')}</span>
            <span className="text-[14px] font-bold text-black/90">{t('pwa.guide.addToHome')}</span>
            <span className="relative">
              <span className="absolute -inset-x-2.5 -inset-y-1.5 rounded-lg border-2 border-[#e02020]" />
              <StepBadge n={3} />
              <span className="text-[14px] font-bold text-[#0a84ff]">{t('pwa.guide.add')}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 border-t border-black/8 px-1 pt-3">
            <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-black/90">BETOGO</p>
              <p className="truncate text-[12px] text-black/45">https://{host}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
