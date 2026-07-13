import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { fetchTaskCenter, type TaskCard, type TaskCenter } from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'
import taskWidgetImg from '@/assets/tasks/task-float-widget.webp'
import ballNewbieImg from '@/assets/tasks/ball-newbie.webp'
import ballDailyImg from '@/assets/tasks/ball-daily.webp'
import ballSocialImg from '@/assets/tasks/ball-social.webp'

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
const CARD_W = 116

// 展开卡片切图：红点与数字已从原图抹除，由代码按原位叠加；num* 为数字左缘/垂直中心的相对坐标
const CARD_ART: Record<TaskBallPath, { img: string; numLeft: string; numTop: string }> = {
  newbie: { img: ballNewbieImg, numLeft: '45.7%', numTop: '67.8%' },
  daily:  { img: ballDailyImg,  numLeft: '47.7%', numTop: '69.8%' },
  social: { img: ballSocialImg, numLeft: '47.1%', numTop: '63.5%' },
}

// 固定在左下角，向右侧竖向弧线展开的卡片终点（相对球心；允许盖住下方 cashback 挂件）
const FAN: { path: TaskBallPath; dx: number; dy: number }[] = [
  { path: 'newbie', dx: 30, dy: -92 },
  { path: 'daily',  dx: 116, dy: -6 },
  { path: 'social', dx: 30, dy: 92 },
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
  const pending = total - done

  async function openPath(path: TaskBallPath) {
    if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
    setExpanded(false)
    onNavigatePath(`/tasks?tab=${path}`)
  }

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
      {/* 固定悬浮在首页左下角（tasks 在上），不可移动 */}
      <div className="pointer-events-none fixed left-2 z-[31] h-24 w-24" style={{ bottom: 214 }}>
        <div className="relative h-24 w-24 select-none">
          {/* 展开态关闭按钮：放在球体左侧空位（卡片向右展开），点击收起 */}
          {expanded && (
            <button
              type="button"
              className="pointer-events-auto absolute -top-1 -left-1 z-[5] flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/75 text-white shadow-[0_4px_12px_rgba(0,0,0,0.5)] active:scale-90"
              onClick={() => setExpanded(false)}
              aria-label={t('tasks.ball.close')}
            >
              <X size={15} strokeWidth={3} />
            </button>
          )}
          {/* 扇形展开卡片：从球心弹出到弧线终点，逐张延迟成扇形展开 */}
          {FAN.map((f, i) => {
            const stat = stats[f.path]
            const art = CARD_ART[f.path]
            return (
              <button
                key={f.path}
                type="button"
                className="pointer-events-auto absolute left-1/2 top-1/2 transition-all duration-300"
                style={{
                  width: CARD_W,
                  transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transitionDelay: expanded ? `${i * 60}ms` : '0ms',
                  transform: expanded
                    ? `translate(calc(-50% + ${f.dx}px), calc(-50% + ${f.dy}px)) scale(1) rotate(0deg)`
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
          {/* 收起态：光晕 + 挂件一起做循环放大缩小的呼吸动效；展开时停止 */}
          <div className={`absolute inset-0 ${expanded ? '' : 'home-float-breathe'}`}>
            {/* 挂件周边渐变透明光晕，展开时淡出 */}
            <span
              aria-hidden
              className={`pointer-events-none absolute -inset-6 rounded-full transition-opacity duration-200 ${expanded ? 'opacity-0' : 'opacity-100'}`}
              style={{ background: 'radial-gradient(circle, rgba(6,4,1,0.55) 30%, rgba(6,4,1,0) 72%)' }}
            />
            <button
              type="button"
              className={`pointer-events-auto relative z-[1] flex h-24 w-24 items-center justify-center transition-transform active:scale-95 ${expanded ? 'scale-110' : ''}`}
              onClick={() => setExpanded((v) => !v)}
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
      </div>
    </>
  )
}
