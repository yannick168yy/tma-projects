import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchTaskCenter, type TaskCard, type TaskCenter } from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'
import taskWidgetImg from '@/assets/tasks/task-float-widget.webp'

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
const BALL_SIZE = 96

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
  const [dragging, setDragging] = useState(false)

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

  const claimable = stats.newbie.claimable + stats.daily.claimable + stats.social.claimable

  const clampFreePosition = useCallback((left: number, top: number) => {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    const minLeft = frameLeft
    const maxLeft = Math.max(minLeft, frameLeft + frameWidth - BALL_SIZE)
    const minTop = 72
    const maxTop = Math.max(minTop, viewportHeight - 156)
    return {
      left: Math.min(Math.max(left, minLeft), maxLeft),
      top: Math.min(Math.max(top, minTop), maxTop),
    }
  }, [])

  const snapPosition = useCallback((left: number, top: number) => {
    const viewportWidth = window.innerWidth
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    const freePosition = clampFreePosition(left, top)
    const edgeLeft = freePosition.left + BALL_SIZE / 2 < frameLeft + frameWidth / 2
      ? frameLeft
      : frameLeft + frameWidth - BALL_SIZE
    return { ...freePosition, left: edgeLeft }
  }, [clampFreePosition])

  const defaultPosition = useCallback(() => {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    return snapPosition(frameLeft + frameWidth - BALL_SIZE, viewportHeight - 240)
  }, [snapPosition])

  useEffect(() => {
    const syncPosition = () => {
      setPosition((current) => {
        const next = current ?? defaultPosition()
        return snapPosition(next.left, next.top)
      })
    }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    return () => window.removeEventListener('resize', syncPosition)
  }, [defaultPosition, snapPosition])

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
    setDragging(false)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    drag.moved = true
    setDragging(true)
    setExpanded(false)
    setPosition(clampFreePosition(drag.startLeft + dx, drag.startTop + dy))
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag.pointerId !== event.pointerId) return
    drag.suppressClick = drag.moved
    if (drag.moved) setPosition((current) => snapPosition(current?.left ?? drag.startLeft, current?.top ?? drag.startTop))
    setDragging(false)
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
    { path: 'newbie', className: 'bottom-[108px] left-1/2 -translate-x-1/2' },
    { path: 'daily', className: isLeftEdge ? 'left-[108px] top-2' : 'right-[108px] top-2' },
    { path: 'social', className: 'left-1/2 top-[108px] -translate-x-1/2' },
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
        className={`pointer-events-none fixed z-[31] h-24 w-24 ${dragging ? '' : 'transition-[left,top] duration-200 ease-out'}`}
        style={position ? { left: position.left, top: position.top } : { right: 88, bottom: 176 }}
      >
        <div
          className="pointer-events-auto relative h-24 w-24 touch-none select-none"
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
          className={`relative flex h-24 w-24 items-center justify-center transition-transform active:scale-95 ${expanded ? 'scale-110' : ''}`}
          onClick={toggleExpanded}
          aria-label={t('tasks.ball.label')}
        >
          <img src={taskWidgetImg} alt="" draggable={false} className="h-24 w-24 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.45)]" />
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
