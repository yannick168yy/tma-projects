import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList } from 'lucide-react'
import { fetchTaskCenter, type TaskCard, type TaskCenter } from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'

type TaskBallPath = 'newbie' | 'daily' | 'social'

interface TaskFloatBallProps {
  onNavigatePath: (path: string) => void
}

interface TaskStat {
  done: number
  total: number
  claimable: number
}

const EMPTY_CENTER: TaskCenter = { groups: { newbie: [], daily: [], achievement: [], social: [] } }

function statOf(cards: TaskCard[]): TaskStat {
  return {
    done: cards.filter((card) => card.status === 'done').length,
    total: cards.length,
    claimable: cards.filter((card) => card.status === 'claimable').length,
  }
}

export default function TaskFloatBall({ onNavigatePath }: TaskFloatBallProps) {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const [center, setCenter] = useState<TaskCenter>(EMPTY_CENTER)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!auth.token) {
      setCenter(EMPTY_CENTER)
      return
    }
    let alive = true
    fetchTaskCenter()
      .then((data) => { if (alive) setCenter(data) })
      .catch(() => { if (alive) setCenter(EMPTY_CENTER) })
    return () => { alive = false }
  }, [auth.token])

  const stats = useMemo(() => ({
    newbie: statOf(center.groups.newbie),
    daily: statOf(center.groups.daily),
    social: statOf(center.groups.social),
  }), [center])

  const total = stats.newbie.total + stats.daily.total + stats.social.total
  const done = stats.newbie.done + stats.daily.done + stats.social.done
  const claimable = stats.newbie.claimable + stats.daily.claimable + stats.social.claimable
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  async function openPath(path: TaskBallPath) {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    setExpanded(false)
    onNavigatePath(`/tasks?tab=${path}`)
  }

  function toggleExpanded() {
    setExpanded((v) => !v)
  }

  const entries: { path: TaskBallPath; className: string }[] = [
    { path: 'newbie', className: 'right-[76px] top-2' },
    { path: 'daily', className: 'bottom-[76px] left-1/2 -translate-x-1/2' },
    { path: 'social', className: 'left-[76px] top-2' },
  ]

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="fixed inset-0 z-30 cursor-default bg-transparent"
          onClick={() => setExpanded(false)}
          aria-label={t('tasks.ball.close')}
        />
      )}
      <div className="pointer-events-none fixed bottom-44 right-[88px] z-[31] h-16 w-16">
        <div className="pointer-events-auto relative h-16 w-16">
        {entries.map((entry) => {
          const stat = stats[entry.path]
          const hot = stat.claimable > 0
          return (
            <button
              key={entry.path}
              type="button"
              className={`absolute flex h-12 w-[78px] flex-col items-center justify-center rounded-2xl border text-center shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-all duration-200 active:scale-95 ${entry.className} ${expanded ? 'scale-100 opacity-100' : 'pointer-events-none scale-75 opacity-0'} ${hot ? 'border-amber-300 bg-[#251804] text-amber-100' : 'border-amber-300/25 bg-[#0b0805]/95 text-amber-100/80'}`}
              onClick={() => void openPath(entry.path)}
            >
              {hot && <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />}
              <span className="text-[10px] font-black leading-none">{t(`tasks.path.${entry.path}`)}</span>
              <span className="mt-1 text-[13px] font-black leading-none tabular-nums text-amber-300">{stat.done}/{stat.total}</span>
            </button>
          )
        })}
        <button
          type="button"
          className={`relative flex h-16 w-16 flex-col items-center justify-center overflow-hidden rounded-full border text-[#261803] shadow-[0_10px_28px_rgba(0,0,0,0.42)] transition-transform active:scale-95 ${expanded ? 'scale-105 border-yellow-200 bg-yellow-300' : 'border-amber-200 bg-gradient-to-b from-amber-200 to-yellow-500'}`}
          onClick={toggleExpanded}
          aria-label={t('tasks.ball.label')}
        >
          <span
            className="absolute inset-0 rounded-full"
            style={{ background: `conic-gradient(rgba(146,64,14,0.32) ${progress * 3.6}deg, rgba(255,255,255,0.22) 0deg)` }}
          />
          <span className="relative flex items-center gap-0.5 text-[13px] font-black leading-none tabular-nums">
            <ClipboardList size={13} strokeWidth={3} />
            {total > 0 ? `${done}/${total}` : t('tasks.ball.short')}
          </span>
          <span className="relative mt-0.5 text-[9px] font-black uppercase leading-none">{t('tasks.ball.label')}</span>
          {claimable > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
              {claimable}
            </span>
          )}
        </button>
        </div>
      </div>
    </>
  )
}
