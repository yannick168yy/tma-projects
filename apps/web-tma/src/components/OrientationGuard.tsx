import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Smartphone } from 'lucide-react'

interface Props {
  // 游戏页允许横屏，传 true 时不拦截
  allowLandscape?: boolean
}

// max-height:600px 限定为手机横屏，PC/大平板宽屏不会误触发
const MQ = '(orientation: landscape) and (max-height: 600px)'

export default function OrientationGuard({ allowLandscape = false }: Props) {
  const { t } = useTranslation()
  const [landscape, setLandscape] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(MQ)
    const update = () => setLandscape(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  if (allowLandscape || !landscape) return null

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-background px-10 text-center">
      <Smartphone size={56} className="text-primary animate-pulse" style={{ transform: 'rotate(90deg)' }} />
      <p className="text-lg font-bold text-white">{t('common.rotateToPortrait')}</p>
      <p className="text-sm text-white/60">{t('common.rotateToPortraitHint')}</p>
    </div>
  )
}
