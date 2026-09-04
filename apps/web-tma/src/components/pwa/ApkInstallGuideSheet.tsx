import { getSiteName } from '@/config/brand'
import { X, Download, ShieldAlert, ChevronRight, CheckCircle2 } from 'lucide-react'

// APK 安装图文引导：Android 从网页装 APK 会被 Play Protect / 未知来源拦截，
// 这里仿真系统弹窗教用户过关。固定英文（面向 PH 用户，与 DownloadPage 仿 Play 一致，不随站点语言）。
// 非内置浏览器时给一个「改用网页版」退路（内置浏览器里 PWA 也装不了，故不显示）。

function StepBadge({ n }: { n: number }) {
  return (
    <span className="absolute -left-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-[#e02020] text-[11px] font-black text-white">
      {n}
    </span>
  )
}

export default function ApkInstallGuideSheet({
  showPwaFallback,
  onPwaFallback,
  onClose,
}: {
  showPwaFallback: boolean
  onPwaFallback: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-[430px] max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-[#f2f2f7] pb-6 text-black"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-center bg-[#f2f2f7] px-4 pb-1 pt-4">
          <h2 className="text-xl font-bold">Almost there — install the app</h2>
          <button
            type="button"
            aria-label="close"
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-black/60"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <p className="mt-1 px-6 text-center text-[13px] text-black/55">
          Your download is starting. Android may warn about installing from the browser — that's normal, just follow these 3 steps.
        </p>

        {/* Step 1：打开下载好的 APK */}
        <p className="mt-4 text-center text-[15px] font-bold text-[#e02020]">1. Open the downloaded file</p>
        <div className="mx-4 mt-2.5 rounded-2xl bg-white p-3 shadow-sm">
          <div className="relative flex items-center gap-3 rounded-xl border-2 border-[#e02020] bg-[#e9e9ee] px-3 py-2.5">
            <StepBadge n={1} />
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a73e8]/10">
              <Download size={18} className="text-[#1a73e8]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-black/90">betogo.apk</p>
              <p className="text-[12px] text-black/50">Download complete · Tap to open</p>
            </div>
          </div>
          <p className="mt-2 px-1 text-[12px] text-black/50">
            Find it in the notification bar, or in <span className="font-semibold">Downloads</span>.
          </p>
        </div>

        {/* Step 2：Play Protect 拦截 → 仍要安装 */}
        <p className="mt-5 text-center text-[15px] font-bold text-[#e02020]">2. Tap "Install anyway"</p>
        <div className="mx-4 mt-2.5 rounded-2xl bg-white p-3 shadow-sm">
          <div className="rounded-xl bg-[#e9e9ee] p-3">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-[#5f6368]" />
              <span className="text-[13px] font-bold text-black/80">Blocked by Play Protect</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-black/55">
              For your security, your phone blocked this app. Tap <span className="font-semibold">More details</span>, then choose to install anyway.
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <span className="rounded-md px-3 py-1.5 text-[13px] font-semibold text-[#1a73e8]">Cancel</span>
              <span className="relative">
                <span className="absolute -inset-x-2 -inset-y-1 rounded-lg border-2 border-[#e02020]" />
                <StepBadge n={2} />
                <span className="rounded-md px-3 py-1.5 text-[13px] font-bold text-[#1a73e8]">Install anyway</span>
              </span>
            </div>
          </div>
          <p className="mt-2 px-1 text-[12px] text-black/50">
            No "Install anyway"? Open <span className="font-semibold">Settings → Security</span> and allow installs from your browser (or turn off "Scan apps with Play Protect").
          </p>
        </div>

        {/* Step 3：装完打开 */}
        <p className="mt-5 text-center text-[15px] font-bold text-[#e02020]">3. Open {getSiteName()}</p>
        <div className="mx-4 mt-2.5 rounded-2xl bg-white p-3 shadow-sm">
          <div className="relative flex items-center gap-3 rounded-xl border-2 border-[#e02020] px-3 py-2.5">
            <StepBadge n={3} />
            <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-black/90">{getSiteName()}</p>
              <p className="text-[12px] text-black/50">Tap Open when install finishes</p>
            </div>
            <CheckCircle2 size={20} className="text-[#137333]" />
          </div>
        </div>

        {showPwaFallback && (
          <button
            type="button"
            onClick={onPwaFallback}
            className="mx-auto mt-5 flex items-center gap-1 text-[13px] font-semibold text-[#1a73e8]"
          >
            Can't install? Use the web version instead
            <ChevronRight size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
