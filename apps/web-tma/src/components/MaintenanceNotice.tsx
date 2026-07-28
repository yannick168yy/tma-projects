import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench } from 'lucide-react'

// 游戏商 2026-07-28 08:00–13:00（+08:00）维护，公告条只在此窗口内自动显示，过点自动消失
const MAINTENANCE_START = Date.parse('2026-07-28T08:00:00+08:00')
const MAINTENANCE_END = Date.parse('2026-07-28T13:00:00+08:00')
function isInMaintenanceWindow() {
  const now = Date.now()
  return now >= MAINTENANCE_START && now < MAINTENANCE_END
}

export default function MaintenanceNotice() {
  const { t } = useTranslation()
  const [show, setShow] = useState(isInMaintenanceWindow)
  useEffect(() => {
    if (Date.now() >= MAINTENANCE_END) return
    const id = setInterval(() => setShow(isInMaintenanceWindow()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!show) return null
  return (
    <div className="flex items-center gap-2 overflow-hidden border-b border-amber-400/30 bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-red-500/15 py-1.5">
      <span className="flex-shrink-0 pl-3 text-amber-400"><Wrench size={13} /></span>
      <div className="relative flex-1 overflow-hidden">
        <div className="maintenance-marquee-track">
          <span className="px-6 text-xs font-semibold text-amber-200">{t('home.maintenanceNotice')}</span>
          <span className="px-6 text-xs font-semibold text-amber-200" aria-hidden="true">{t('home.maintenanceNotice')}</span>
        </div>
      </div>
    </div>
  )
}
