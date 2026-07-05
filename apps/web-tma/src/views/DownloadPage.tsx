import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Star, Loader2, CheckCircle2 } from 'lucide-react'
import InstallGuideSheet from '@/components/pwa/InstallGuideSheet'
import { canNativeInstall, isIos, isStandalone, promptNativeInstall } from '@/utils/pwa'

// APK 上线后填入下载地址（如 /app/betogo.apk）；为空时 Android 走 PWA 安装过渡方案
const APK_DOWNLOAD_URL = ''

// 仿应用商店页，文案固定英文（面向 PH 用户，模拟 Play Store 不随站点语言切换）
const SCREENSHOTS = [
  { title: 'SIGN UP = ₱777', sub: 'FREE BONUS', foot: 'CLAIM YOUR REWARD INSTANTLY! YOUR PRIZE CAN MULTIPLY UP TO 12X!', from: '#1b2a6b', to: '#0c1024' },
  { title: 'INVITE ONE PERSON', sub: 'AND GET ₱300', foot: 'BETTING CASHBACK UP TO 4%', from: '#4a1265', to: '#140b2e' },
  { title: 'RECEIVE ₱500', sub: 'FOR FREE', foot: 'FAST WITHDRAWALS IN SECONDS', from: '#0d4b3a', to: '#071f18' },
]

const RATING_BARS = [100, 26, 10, 7, 3]

const REVIEWS = [
  {
    name: 'maricel dizon',
    color: '#c2568c',
    date: 'june 21, 2026',
    rating: 5,
    text: 'legit sya, nag cash out ako kahapon 30 mins lang nasa gcash na agad. sulit ung vip rewards araw araw may bonus.',
    helpful: 231,
  },
  {
    name: 'john rey santos',
    color: '#3f7fc1',
    date: 'june 14, 2026',
    rating: 5,
    text: 'grabe ung 500 ko naging 3,800 sa super ace hahaha solid! mabilis din mag load walang lag.',
    helpful: 187,
  },
  {
    name: 'kristine mae',
    color: '#4ca06a',
    date: 'may 30, 2026',
    rating: 4,
    text: 'ok naman, mabilis ang withdrawal at maraming games. sana dagdagan pa ung mga bingo events.',
    helpful: 96,
  },
]

function Stars({ n, size = 12 }: { n: number; size?: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= n ? 'fill-[#1a73e8] text-[#1a73e8]' : 'fill-[#dadce0] text-[#dadce0]'} />
      ))}
    </span>
  )
}

export default function DownloadPage({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'installing' | 'done'>('idle')
  const [progress, setProgress] = useState(0)
  const [guideOpen, setGuideOpen] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current) }, [])

  function finishInstall() {
    setPhase('done')
    window.setTimeout(() => {
      if (isIos()) {
        setGuideOpen(true)
        return
      }
      if (APK_DOWNLOAD_URL) {
        window.location.href = APK_DOWNLOAD_URL
        return
      }
      if (canNativeInstall()) {
        void promptNativeInstall()
        return
      }
      setGuideOpen(true)
    }, 350)
  }

  function startInstall() {
    if (phase === 'installing') return
    if (isStandalone()) return
    setPhase('installing')
    setProgress(0)
    timerRef.current = window.setInterval(() => {
      setProgress((p) => {
        const next = Math.min(100, p + 2 + Math.floor(Math.random() * 6))
        if (next >= 100 && timerRef.current) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
          finishInstall()
        }
        return next
      })
    }, 90)
  }

  const installed = isStandalone()

  return (
    <div className="min-h-dvh bg-white pb-10 text-[#202124]" style={{ paddingTop: 'var(--app-safe-top)' }}>
      <div className="flex items-center px-3 py-2.5">
        <button type="button" aria-label="back" className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] active:bg-black/5" onClick={onClose}>
          <ChevronLeft size={22} />
        </button>
      </div>

      {/* 应用头 */}
      <div className="flex items-start gap-4 px-5">
        <img src="/icons/icon-192.png" alt="BETOGO" className="h-[76px] w-[76px] flex-shrink-0 rounded-2xl shadow-md shadow-black/20" />
        <div className="min-w-0 pt-0.5">
          <h1 className="text-[22px] font-bold leading-tight">BETOGO Cash Craze</h1>
          <p className="mt-1 text-[14px] font-semibold text-[#1a73e8]">Brand website, 100% credibility</p>
          <p className="mt-0.5 text-[12px] text-[#5f6368]">App Verified</p>
        </div>
      </div>

      {/* 统计条 */}
      <div className="mt-5 flex items-center px-5 text-center">
        <div className="flex-1">
          <p className="flex items-center justify-center gap-1 text-[15px] font-bold">4.7<Star size={12} className="fill-[#202124] text-[#202124]" /></p>
          <p className="mt-0.5 text-[11px] text-[#5f6368]">86M+ reviews</p>
        </div>
        <div className="h-7 w-px bg-[#e8eaed]" />
        <div className="flex-1">
          <p className="text-[15px] font-bold">100M+</p>
          <p className="mt-0.5 text-[11px] text-[#5f6368]">Downloading</p>
        </div>
        <div className="h-7 w-px bg-[#e8eaed]" />
        <div className="flex-1">
          <p className="text-[15px] font-bold">21+</p>
          <p className="mt-0.5 text-[11px] text-[#5f6368]">Rated 21+</p>
        </div>
      </div>

      {/* 安装按钮：假 quick install（转圈+百分比），完成后 iOS 弹 PWA 引导 / Android 下 APK 或原生安装 */}
      <div className="mt-5 px-5">
        {installed ? (
          <p className="flex items-center justify-center gap-1.5 rounded-lg bg-[#e6f4ea] py-3 text-sm font-bold text-[#137333]">
            <CheckCircle2 size={16} />
            App installed — open it from your home screen
          </p>
        ) : (
          <button
            type="button"
            className="relative w-full overflow-hidden rounded-lg bg-[#1a73e8] py-3 text-[15px] font-bold text-white active:opacity-90"
            onClick={startInstall}
          >
            {phase === 'installing' && (
              <span className="absolute inset-y-0 left-0 bg-[#0d47a1] transition-[width] duration-150" style={{ width: `${progress}%` }} />
            )}
            <span className="relative flex items-center justify-center gap-2">
              {phase === 'installing' ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  Installing… {progress}%
                </>
              ) : phase === 'done' ? (
                <>
                  <CheckCircle2 size={17} />
                  Install the app
                </>
              ) : (
                <>Get the app {isIos() ? 'on the App Store' : 'on Google Play'} ↓</>
              )}
            </span>
          </button>
        )}
      </div>

      {/* 宣传图横滑 */}
      <div className="hide-scrollbar mt-5 flex gap-3 overflow-x-auto px-5">
        {SCREENSHOTS.map((s) => (
          <div
            key={s.title}
            className="flex h-[300px] w-[168px] flex-shrink-0 flex-col items-center justify-between rounded-xl border border-black/10 p-4 text-center"
            style={{ background: `linear-gradient(180deg, ${s.from}, ${s.to})` }}
          >
            <img src="/icons/icon-192.png" alt="" className="h-14 w-14 rounded-xl shadow-lg shadow-black/40" />
            <div>
              <p className="text-[17px] font-black leading-tight text-[#ffd75e]">{s.title}</p>
              <p className="mt-1 text-[15px] font-black leading-tight text-white">{s.sub}</p>
            </div>
            <p className="rounded-lg border border-white/25 bg-white/10 px-2 py-1.5 text-[9px] font-semibold leading-snug text-white/90">{s.foot}</p>
          </div>
        ))}
      </div>

      {/* About */}
      <div className="mt-6 px-5">
        <h2 className="text-[18px] font-bold">About this App</h2>
        <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[#3c4043]">
          {'🔥 🌟🌟🌟🌟🌟 4.9, no ads, smooth game, credit guaranteed, millions of funds withdrawn in seconds 🔥\n🎁 Get ₱777 free bonus 🎁 Free and fast withdrawals 🎁\nUltimate VIP Rewards Club\nUpgrade bonus: ₱277,777\nDaily bonus: ₱77,777\nWeekly bonus: ₱127,777\nMonthly bonus: ₱177,777'}
        </p>
      </div>

      {/* Ratings and Reviews */}
      <div className="mt-7 px-5">
        <h2 className="text-[18px] font-bold">Ratings and Reviews</h2>
        <p className="mt-1.5 text-[12px] text-[#5f6368]">Ratings and reviews are verified and from users with the same device type as yours</p>

        <div className="mt-3 flex gap-2">
          <span className="rounded-full border border-[#137333]/30 bg-[#e6f4ea] px-3.5 py-1.5 text-[12px] font-semibold text-[#137333]">📱 Phone</span>
          <span className="rounded-full border border-[#dadce0] px-3.5 py-1.5 text-[12px] font-semibold text-[#5f6368]">Tablet</span>
        </div>

        <div className="mt-4 flex items-center gap-5">
          <div>
            <p className="text-[44px] font-normal leading-none">4.7</p>
            <div className="mt-1.5"><Stars n={5} size={13} /></div>
            <p className="mt-1.5 text-[11px] text-[#5f6368]">86,127,937 reviews</p>
          </div>
          <div className="flex-1 space-y-1.5">
            {RATING_BARS.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2 text-[11px] text-[#5f6368]">{5 - i}</span>
                <div className="h-2.5 flex-1 rounded-full bg-[#e8eaed]">
                  <div className="h-2.5 rounded-full bg-[#1a73e8]" style={{ width: `${w}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {REVIEWS.map((r) => (
            <div key={r.name}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: r.color }}>
                  {r.name[0].toUpperCase()}
                </span>
                <span className="text-[13px] font-medium">{r.name}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Stars n={r.rating} />
                <span className="text-[11px] text-[#5f6368]">{r.date}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#3c4043]">{r.text}</p>
              <p className="mt-1 text-[11px] text-[#5f6368]">This review has been marked as helpful by {r.helpful} people</p>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#5f6368]">
                Did you find this helpful?
                <span className="rounded-full border border-[#dadce0] px-3 py-0.5">Yes</span>
                <span className="rounded-full border border-[#dadce0] px-3 py-0.5">No</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {guideOpen && (
        <InstallGuideSheet
          platform={isIos() ? 'ios' : 'android'}
          title="Install the app"
          onClose={() => setGuideOpen(false)}
        />
      )}
    </div>
  )
}
