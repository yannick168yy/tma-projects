import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Star, Loader2, CheckCircle2, ShieldCheck, Share2, Trash2, Flag } from 'lucide-react'
import InstallGuideSheet from '@/components/pwa/InstallGuideSheet'
import ApkInstallGuideSheet from '@/components/pwa/ApkInstallGuideSheet'
import { canNativeInstall, isIos, isInstalledApp, isInAppWebView, promptNativeInstall } from '@/utils/pwa'
import { reportInstallClick } from '@/api/attribution'
import { useTranslation } from 'react-i18next'

const APK_DOWNLOAD_ORIGIN = (import.meta.env.VITE_APK_DOWNLOAD_ORIGIN?.trim() || 'https://betogo.app').replace(/\/$/, '')
const APK_DOWNLOAD_URLS = {
  id: `${APK_DOWNLOAD_ORIGIN}/app/id/betogo.apk`,
  ph: `${APK_DOWNLOAD_ORIGIN}/app/ph/betogo.apk`,
} as const

// 仿应用商店页，文案固定英文（面向 PH 用户，模拟 Play Store 不随站点语言切换）
const SCREENSHOTS = [
  '/dl/shots/shot1.webp',
  '/dl/shots/shot2.webp',
  '/dl/shots/shot3.webp',
  '/dl/shots/shot4.webp',
  '/dl/shots/shot5.webp',
]

const ABOUT_TEXT = `🔥 🌟🌟🌟🌟🌟 4.9, no ads, smooth game, credit guaranteed, funds withdrawn in seconds 🔥
🎁 First Deposit 120% Bonus up to ₱1,000 🎁 Free and fast withdrawals 🎁
Ultimate VIP Rewards Club
Weekly Pay + Monthly Pay + Birthday Gift
Loss Rebate up to 7% back — auto relief on every losing day
Cash Rebate up to 2% on EVERY bet, auto-credited daily at midnight
Daily Check-in = FREE Lucky Wheel spins 🎡 higher tiers, bigger pots
Task Center: Newbie Bonus ₱18 + First Bet ₱5 + Invite Friends ₱10
JILI · PG · FaChai · CQ9 · Pragmatic Play — 2,000+ games in one app`

const TAGS = ['Casino', 'Slots', 'Bingo', 'Live Casino', 'Multiplayer']

const RATING_BARS = [100, 26, 10, 7, 3]

const REVIEWS = [
  {
    name: 'maricel dizon',
    avatar: '/dl/avatars/user1.jpg',
    date: 'july 12, 2026',
    rating: 5,
    text: 'legit sya, nag cash out ako kahapon 30 mins lang nasa gcash na agad. sulit ung vip rewards araw araw may bonus.',
    helpful: 231,
  },
  {
    name: 'john rey santos',
    avatar: '/dl/avatars/user2.jpg',
    date: 'july 8, 2026',
    rating: 5,
    text: 'grabe ung 500 ko naging 3,800 sa super ace hahaha solid! mabilis din mag load walang lag.',
    helpful: 187,
  },
  {
    name: 'kristine mae',
    avatar: '/dl/avatars/user3.jpg',
    date: 'june 30, 2026',
    rating: 4,
    text: 'ok naman, mabilis ang withdrawal at maraming games. sana dagdagan pa ung mga bingo events.',
    helpful: 96,
  },
  {
    name: 'shiela hernandez',
    avatar: '/dl/avatars/user4.jpg',
    date: 'june 27, 2026',
    rating: 5,
    text: 'grabe ung vip benefits dito, sa iba weekly lang. dito may daily check in, weekly tapos may monthly pa.',
    helpful: 154,
  },
  {
    name: 'julia padilla',
    avatar: '/dl/avatars/user5.jpg',
    date: 'june 22, 2026',
    rating: 5,
    text: 'may cash rebate pala kahit natalo, automatic pumapasok every midnight. tsaka ung lucky wheel libre araw araw.',
    helpful: 118,
  },
  {
    name: 'andrea madrid',
    avatar: '/dl/avatars/user6.jpg',
    date: 'june 18, 2026',
    rating: 5,
    text: 'akala ko di na mawiwithdraw ung panalo ko, buti nalang ang bilis mag response ng customer service, 5 minutes lang nasolve agad.',
    helpful: 89,
  },
]

// Similar games 取自我方首页高权重游戏，封面走 bff 本地图（测试/生产同源可用）
const SIMILAR_GAMES = [
  { name: 'Super Ace', dev: 'JILI', rating: '4.8', img: '/api/v1/home/images/covers/ptgaming/JILI__Super_Ace__460.webp' },
  { name: 'Fortune Gems', dev: 'JILI', rating: '4.9', img: '/api/v1/home/images/covers/ptgaming/JILI__Fortune_Gems__471.webp' },
  { name: 'Wild Bounty Showdown', dev: 'PG Soft', rating: '4.7', img: '/api/v1/home/images/covers/ptgaming/PGSoft__Wild_Bounty_Showdown__333.webp' },
  { name: 'Pinata Wins', dev: 'PG Soft', rating: '4.7', img: '/api/v1/home/images/covers/ptgaming/PGSoft__Pinata_Wins__42009.webp' },
  { name: 'Color Game', dev: 'JILI', rating: '4.8', img: '/api/v1/home/images/covers/bingoplus/161__197__Color_game_540.webp' },
  { name: 'Zeus', dev: 'CQ9', rating: '4.6', img: '/api/v1/home/images/covers/ptgaming/CQ9__Zeus__190002.webp' },
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
  const { i18n } = useTranslation()
  const apkMarket = i18n.resolvedLanguage?.toLowerCase().startsWith('id') ? 'id' : 'ph'
  const apkDownloadUrl = APK_DOWNLOAD_URLS[apkMarket]
  const [phase, setPhase] = useState<'idle' | 'installing' | 'done'>('idle')
  const [progress, setProgress] = useState(0)
  const [guideOpen, setGuideOpen] = useState(false)
  const [apkGuideOpen, setApkGuideOpen] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current) }, [])

  // APK 装不上时的退路：能原生装 PWA 就直接弹，否则给 PWA 图文引导。仅系统浏览器可达（内置浏览器 PWA 也装不了）
  function goPwaFallback() {
    setApkGuideOpen(false)
    if (canNativeInstall()) {
      void promptNativeInstall()
      return
    }
    setGuideOpen(true)
  }

  function finishInstall() {
    setPhase('done')
    window.setTimeout(() => {
      // iOS 装不了 APK，只能引导 PWA 添加到主屏。主屏 PWA 容器与 Safari 存储隔离，
      // 归因快照同样要走服务端配对桥（PWA 首启认领）
      if (isIos()) {
        reportInstallClick()
        setGuideOpen(true)
        return
      }
      // Android 主路径：触发 APK 下载，同时弹安装引导教用户过 Play Protect 拦截。
      // 用 <a download> 而非 location.href —— 后者会发起页面导航把当前页(和引导弹窗)冲掉
      if (apkDownloadUrl) {
        const a = document.createElement('a')
        a.href = apkDownloadUrl
        a.download = `betogo-${apkMarket}.apk`
        document.body.appendChild(a)
        a.click()
        a.remove()
        // 归因快照暂存服务端，装好的 App 首启认领（浏览器与 App 存储隔离，直传不过去）
        reportInstallClick()
        setApkGuideOpen(true)
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
    if (isInstalledApp()) return
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

  const installed = isInstalledApp()

  const installButton = (
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
  )

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
          <p className="text-[15px] font-bold">3+</p>
          <p className="mt-0.5 text-[11px] text-[#5f6368]">Rated 3+</p>
        </div>
      </div>

      {/* 安装按钮：假 quick install（转圈+百分比），完成后 iOS 弹 PWA 引导 / Android 下 APK 或原生安装 */}
      <div className="mt-5 px-5">
        {installed ? (
          <p className="flex items-center justify-center gap-1.5 rounded-lg bg-[#e6f4ea] py-3 text-sm font-bold text-[#137333]">
            <CheckCircle2 size={16} />
            App installed — open it from your home screen
          </p>
        ) : installButton}
      </div>

      {/* 应用内截图横滑 */}
      <div className="hide-scrollbar mt-5 flex gap-3 overflow-x-auto px-5">
        {SCREENSHOTS.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            loading={i < 2 ? 'eager' : 'lazy'}
            className="h-[300px] w-auto flex-shrink-0 rounded-xl border border-black/10 object-cover"
          />
        ))}
      </div>

      {/* About */}
      <div className="mt-6 px-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold">About this App</h2>
          <ChevronRight size={20} className="text-[#5f6368]" />
        </div>
        <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[#3c4043]">{ABOUT_TEXT}</p>
        <p className="mt-4 text-[13px] font-medium">Updated on</p>
        <p className="mt-0.5 text-[13px] text-[#5f6368]">July 15, 2026</p>
        <div className="hide-scrollbar mt-3 flex gap-2 overflow-x-auto">
          <span className="flex-shrink-0 rounded-full border border-[#dadce0] px-3.5 py-1.5 text-[12px] font-semibold text-[#3c4043]">#1 Top Free Casino Apps</span>
          {TAGS.map((t) => (
            <span key={t} className="flex-shrink-0 rounded-full border border-[#dadce0] px-3.5 py-1.5 text-[12px] font-semibold text-[#3c4043]">{t}</span>
          ))}
        </div>
      </div>

      {/* Data Safety */}
      <div className="mt-7 px-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold">Data Safety</h2>
          <ChevronRight size={20} className="text-[#5f6368]" />
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-[#5f6368]">
          Your safety starts with understanding how developers collect and share your data. Data security and privacy practices may vary based on usage, region, and age. The developer provided the following information, which may be updated over time.
        </p>
        <div className="mt-3 space-y-3 rounded-xl border border-[#dadce0] p-4">
          <div className="flex gap-3">
            <Share2 size={18} className="mt-0.5 flex-shrink-0 text-[#5f6368]" />
            <p className="text-[13px] leading-relaxed text-[#3c4043]">This app does not share your data with third parties</p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck size={18} className="mt-0.5 flex-shrink-0 text-[#5f6368]" />
            <p className="text-[13px] leading-relaxed text-[#3c4043]">Data is encrypted in transit</p>
          </div>
          <div className="flex gap-3">
            <Trash2 size={18} className="mt-0.5 flex-shrink-0 text-[#5f6368]" />
            <p className="text-[13px] leading-relaxed text-[#3c4043]">You can request that data be deleted</p>
          </div>
          <p className="pl-[30px] text-[13px] font-semibold text-[#1a73e8]">View details</p>
        </div>
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
                <img src={r.avatar} alt="" loading="lazy" className="h-8 w-8 rounded-full object-cover" />
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

        <p className="mt-5 text-[14px] font-semibold text-[#1a73e8]">View all reviews</p>
      </div>

      {/* What's new */}
      <div className="mt-7 px-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold">What's new</h2>
          <ChevronRight size={20} className="text-[#5f6368]" />
        </div>
        <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[#3c4043]">
          {'Hello lovers, a new version is here! Here are some surprises for you!\n- New: Task Center — claim your Newbie Bonus\n- New: Daily Check-in with FREE Lucky Wheel spins\n- Cash Rebate upgraded, auto-credited every midnight\n- Bug fixed\nNow is the time to spin and win!'}
        </p>
      </div>

      {/* Similar games */}
      <div className="mt-7 px-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold">Similar games</h2>
          <ChevronRight size={20} className="text-[#5f6368]" />
        </div>
        <div className="hide-scrollbar mt-3 flex gap-4 overflow-x-auto">
          {SIMILAR_GAMES.map((g) => (
            <div key={g.name} className="w-[88px] flex-shrink-0">
              <img src={g.img} alt={g.name} loading="lazy" className="h-[88px] w-[88px] rounded-xl object-cover" />
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-[#202124]">{g.name}</p>
              <p className="mt-0.5 text-[11px] text-[#5f6368]">{g.dev}</p>
              <p className="mt-0.5 flex items-center gap-0.5 text-[11px] text-[#5f6368]">{g.rating}<Star size={9} className="fill-[#5f6368] text-[#5f6368]" /></p>
            </div>
          ))}
        </div>
      </div>

      {/* Flag as inappropriate */}
      <div className="mt-7 flex items-center gap-3 border-t border-[#e8eaed] px-5 pt-5 text-[#5f6368]">
        <Flag size={16} />
        <span className="text-[13px]">Flag as inappropriate</span>
      </div>

      {/* 底部再放一个安装入口 */}
      <div className="mt-6 px-5">
        {!installed && installButton}
      </div>

      {guideOpen && (
        <InstallGuideSheet
          platform={isIos() ? 'ios' : 'android'}
          title="Install the app"
          onClose={() => setGuideOpen(false)}
        />
      )}

      {apkGuideOpen && (
        <ApkInstallGuideSheet
          showPwaFallback={!isInAppWebView()}
          onPwaFallback={goPwaFallback}
          onClose={() => setApkGuideOpen(false)}
        />
      )}
    </div>
  )
}
