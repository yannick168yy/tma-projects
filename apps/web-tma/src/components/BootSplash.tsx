import { useEffect, useState } from 'react'
import { isInstalledApp } from '@/utils/pwa'
import bootImg from '@/assets/game-loading.webp'

const SHOW_MS = 2500
const FADE_MS = 300

// App（APK 壳 / 主屏 PWA）启动品牌屏。Android 12+ 的系统启动屏强制"居中小图标"样式，
// 全屏宣传图只能在 web 层做；放这里同时覆盖 iOS PWA，且换图不用重新发包。
// 只在冷启动（页面加载）时出现一次；切后台再回来不重放。
export default function BootSplash() {
  const [state, setState] = useState<'shown' | 'fading' | 'gone'>(() => (isInstalledApp() ? 'shown' : 'gone'))
  const [barStarted, setBarStarted] = useState(false)

  useEffect(() => {
    if (state === 'gone') return
    const raf = requestAnimationFrame(() => setBarStarted(true))
    const t1 = setTimeout(() => setState('fading'), SHOW_MS)
    const t2 = setTimeout(() => setState('gone'), SHOW_MS + FADE_MS)
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'gone') return null

  return (
    <div
      className={`fixed inset-0 z-[200] bg-[#080b14] transition-opacity duration-300 ${state === 'fading' ? 'opacity-0' : 'opacity-100'}`}
    >
      <img src={bootImg} alt="" draggable={false} className="w-full h-full object-cover object-top select-none" />
      <div
        className="absolute inset-x-0 flex flex-col items-center"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)' }}
      >
        <div className="w-2/3 max-w-[280px] h-1.5 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-300"
            style={{ width: barStarted ? '100%' : '5%', transition: `width ${SHOW_MS - 100}ms ease-out` }}
          />
        </div>
      </div>
    </div>
  )
}
