import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { fetchTaskCenter, type TaskCard, type TaskCenter } from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'
import taskWidgetImg from '@/assets/tasks/task-float-widget.webp'
import ballNewbieImg from '@/assets/tasks/ball-newbie.webp'
import ballDailyImg from '@/assets/tasks/ball-daily.webp'
import ballSocialImg from '@/assets/tasks/ball-social.webp'
import edgeTabImg from '@/assets/tasks/tasks-edge-tab.webp'

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
const CARD_W = 116

// 展开卡片切图：红点与数字已从原图抹除，由代码按原位叠加；num* 为数字左缘/垂直中心的相对坐标
const CARD_ART: Record<TaskBallPath, { img: string; numLeft: string; numTop: string }> = {
  newbie: { img: ballNewbieImg, numLeft: '45.7%', numTop: '67.8%' },
  daily:  { img: ballDailyImg,  numLeft: '47.7%', numTop: '69.8%' },
  social: { img: ballSocialImg, numLeft: '47.1%', numTop: '63.5%' },
}

// 扇形展开的卡片终点（相对球心，贴右边缘时向左展开；贴左边缘时 dx 取反）
const FAN: { path: TaskBallPath; dx: number; dy: number }[] = [
  { path: 'newbie', dx: -30, dy: -92 },
  { path: 'daily',  dx: -116, dy: -6 },
  { path: 'social', dx: -30, dy: 92 },
]

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
  const [docked, setDocked] = useState(false)
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

  const total = stats.newbie.total + stats.daily.total + stats.social.total
  const done = stats.newbie.done + stats.daily.done + stats.social.done
  const pending = total - done

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

  // 松手后固定吸附到右边缘（不再就近吸附）
  const snapPosition = useCallback((left: number, top: number) => {
    const viewportWidth = window.innerWidth
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    const freePosition = clampFreePosition(left, top)
    return { ...freePosition, left: frameLeft + frameWidth - BALL_SIZE }
  }, [clampFreePosition])

  // 默认出现在右上方；拖动松手后仍吸附到右边缘（onPointerUp 的 snapPosition）
  const defaultPosition = useCallback(() => {
    const viewportWidth = window.innerWidth
    const frameWidth = Math.min(viewportWidth, 430)
    const frameLeft = (viewportWidth - frameWidth) / 2
    return clampFreePosition(frameLeft + frameWidth - BALL_SIZE, 96)
  }, [clampFreePosition])

  useEffect(() => {
    const syncPosition = () => {
      setPosition((current) => {
        const next = current ?? defaultPosition()
        return clampFreePosition(next.left, next.top)
      })
    }
    syncPosition()
    window.addEventListener('resize', syncPosition)
    return () => window.removeEventListener('resize', syncPosition)
  }, [defaultPosition, clampFreePosition])

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

  function dockToEdge() {
    setExpanded(false)
    setDocked(true)
  }

  function undock() {
    setDocked(false)
    setPosition((current) => snapPosition(current?.left ?? 0, current?.top ?? 0))
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

  // 右边缘挂件的定位：贴帧右边缘、纵向对齐悬浮球
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 375
  const frameWidth = Math.min(viewportWidth, 430)
  const frameRight = (viewportWidth - frameWidth) / 2
  const dockTop = position?.top ?? 176

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
        className={`pointer-events-none fixed z-[31] h-24 w-24 duration-300 ease-out ${dragging ? 'transition-[transform,opacity]' : 'transition-all'} ${docked ? 'translate-x-[135%] opacity-0' : 'opacity-100'}`}
        style={position ? { left: position.left, top: position.top } : { right: 88, bottom: 176 }}
      >
        <div
          className={`relative h-24 w-24 touch-none select-none ${docked ? 'pointer-events-none' : 'pointer-events-auto'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
        {/* 展开态关闭按钮：点击收进右边缘 */}
        {expanded && (
          <button
            type="button"
            data-task-ball-entry
            className="absolute -top-2 right-0 z-[3] flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/75 text-white shadow-[0_4px_12px_rgba(0,0,0,0.5)] active:scale-90"
            onClick={dockToEdge}
            aria-label={t('tasks.ball.close')}
          >
            <X size={15} strokeWidth={3} />
          </button>
        )}
        {/* 挂件周边渐变透明光晕，展开时淡出 */}
        <span
          aria-hidden
          className={`pointer-events-none absolute -inset-4 rounded-full transition-opacity duration-200 ${expanded ? 'opacity-0' : 'opacity-100'}`}
          style={{ background: 'radial-gradient(circle, rgba(6,4,1,0.55) 30%, rgba(6,4,1,0) 72%)' }}
        />
        {/* 扇形展开卡片：从球心弹出到弧线终点，逐张延迟成扇形展开 */}
        {FAN.map((f, i) => {
          const stat = stats[f.path]
          const art = CARD_ART[f.path]
          const dx = isLeftEdge ? -f.dx : f.dx
          return (
            <button
              key={f.path}
              type="button"
              data-task-ball-entry
              className="absolute left-1/2 top-1/2 transition-all duration-300"
              style={{
                width: CARD_W,
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                transitionDelay: expanded ? `${i * 60}ms` : '0ms',
                transform: expanded
                  ? `translate(calc(-50% + ${dx}px), calc(-50% + ${f.dy}px)) scale(1) rotate(0deg)`
                  : 'translate(-50%, -50%) scale(0.2) rotate(-12deg)',
                opacity: expanded ? 1 : 0,
                pointerEvents: expanded ? 'auto' : 'none',
              }}
              onClick={() => void openPath(f.path)}
              aria-label={t(`tasks.path.${f.path}`)}
            >
              <img src={art.img} alt="" draggable={false} className="w-full drop-shadow-[0_8px_18px_rgba(0,0,0,0.4)]" />
              <span
                className="absolute -translate-y-1/2 text-[14px] font-black leading-none tabular-nums"
                style={{ left: art.numLeft, top: art.numTop, color: 'var(--primary)', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
              >
                {stat.done}/{stat.total}
              </span>
              {stat.total - stat.done > 0 && (
                <span className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" style={{ left: '91.4%', top: '17%' }} />
              )}
            </button>
          )
        })}
        <button
          type="button"
          className={`relative z-[1] flex h-24 w-24 items-center justify-center transition-transform active:scale-95 ${expanded ? 'scale-110' : ''}`}
          onClick={toggleExpanded}
          aria-label={t('tasks.ball.label')}
        >
          <img src={taskWidgetImg} alt="" draggable={false} className="h-24 w-24 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.45)]" />
          {!expanded && pending > 0 && (
            <span className="absolute right-0 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-black text-primary-foreground shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
              {pending}
            </span>
          )}
        </button>
        </div>
      </div>

      {/* 收进右边缘的 TASKS 挂件：点击滑出还原 */}
      <button
        type="button"
        className={`fixed z-[31] duration-300 ease-out transition-all active:scale-95 ${docked ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'}`}
        style={{ right: frameRight, top: dockTop, height: 60 }}
        onClick={undock}
        aria-label={t('tasks.ball.label')}
      >
        <img src={edgeTabImg} alt="" draggable={false} className="h-full w-auto drop-shadow-[0_6px_16px_rgba(0,0,0,0.45)]" />
      </button>
    </>
  )
}
