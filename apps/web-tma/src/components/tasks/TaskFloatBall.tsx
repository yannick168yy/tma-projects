import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
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
const BALL_SIZE = 64

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
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, startLeft: 0, startTop: 0, moved: false, suppressClick: false })
  const [center, setCenter] = useState<TaskCenter>(EMPTY_CENTER)
  const [expanded, setExpanded] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

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

  const clampPosition = useCallback((left: number, top: number) => {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    const minLeft = frameLeft
    const maxLeft = Math.max(minLeft, frameLeft + frameWidth - BALL_SIZE)
    const nextLeft = left + BALL_SIZE / 2 < frameLeft + frameWidth / 2 ? minLeft : maxLeft
    const minTop = 72
    const maxTop = Math.max(minTop, viewportHeight - 156)
    return {
      left: nextLeft,
      top: Math.min(Math.max(top, minTop), maxTop),
    }
  }, [])

  const defaultPosition = useCallback(() => {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    return clampPosition(frameLeft + frameWidth - BALL_SIZE, viewportHeight - 240)
  }, [clampPosition])

  useEffect(() => {
    const syncPosition = () => {
      setPosition((current) => {
        const next = current ?? defaultPosition()
        return clampPosition(next.left, next.top)
      })
    }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    return () => window.removeEventListener('resize', syncPosition)
  }, [clampPosition, defaultPosition])

  async function openPath(path: TaskBallPath) {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    setExpanded(false)
    onNavigatePath(`/tasks?tab=${path}`)
  }

  function toggleExpanded() {
    if (dragRef.current.suppressClick) {
      dragRef.current.suppressClick = false
      return
    }
    setExpanded((v) => !v)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-task-ball-entry]')) return
    const current = position ?? defaultPosition()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: current.left,
      startTop: current.top,
      moved: false,
      suppressClick: false,
    }
    setPosition(current)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    drag.moved = true
    setExpanded(false)
    setPosition(clampPosition(drag.startLeft + dx, drag.startTop + dy))
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag.pointerId !== event.pointerId) return
    drag.suppressClick = drag.moved
    if (drag.moved) window.setTimeout(() => { dragRef.current.suppressClick = false }, 0)
    drag.pointerId = -1
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const isLeftEdge = (() => {
    if (!position) return false
    const viewportWidth = window.innerWidth
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    return position.left < frameLeft + frameWidth / 2
  })()

  const entries: { path: TaskBallPath; className: string }[] = [
    { path: 'newbie', className: 'bottom-[76px] left-1/2 -translate-x-1/2' },
    { path: 'daily', className: isLeftEdge ? 'left-[76px] top-2' : 'right-[76px] top-2' },
    { path: 'social', className: 'left-1/2 top-[76px] -translate-x-1/2' },
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
      <div
        className="pointer-events-none fixed z-[31] h-16 w-16"
        style={position ? { left: position.left, top: position.top } : { right: 88, bottom: 176 }}
      >
        <div
          className="pointer-events-auto relative h-16 w-16 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
        {entries.map((entry) => {
          const stat = stats[entry.path]
          const hot = stat.claimable > 0
          return (
            <button
              key={entry.path}
              type="button"
              data-task-ball-entry
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
