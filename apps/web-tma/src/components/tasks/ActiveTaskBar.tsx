import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Target, X } from 'lucide-react'
import { useActiveTaskStore, isClaimableNow } from '@/stores/activeTask'
import { cardSubtitle, cardTitle, rewardText } from '@/components/tasks/taskLabels'

const POLL_MS = 10_000
const SUCCESS_HOLD_MS = 2600

export default function ActiveTaskBar({
  bottomOffset,
  hidden,
  onReturnToTasks,
}: {
  bottomOffset: number
  hidden: boolean
  onReturnToTasks: () => void
}) {
  const { t } = useTranslation()
  const task = useActiveTaskStore((s) => s.task)
  const claiming = useActiveTaskStore((s) => s.claiming)
  const success = useActiveTaskStore((s) => s.success)
  const sync = useActiveTaskStore((s) => s.sync)
  const claim = useActiveTaskStore((s) => s.claim)
  const clear = useActiveTaskStore((s) => s.clear)

  // 任务条被游戏/钱包等全屏层盖住时不轮询；重新可见立即同步一次，退出游戏即可看到达标态
  const taskId = task?.id
  useEffect(() => {
    if (!taskId || success || hidden) return
    void sync()
    const timer = setInterval(() => { if (!document.hidden) void sync() }, POLL_MS)
    const onVisible = () => { if (!document.hidden) void sync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [taskId, success, hidden, sync])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(clear, SUCCESS_HOLD_MS)
    return () => clearTimeout(timer)
  }, [success, clear])

  if (!task || hidden) return null

  const reward = rewardText(t, task)
  const claimable = isClaimableNow(task)
  const progressPct = task.progress
    ? Math.min(100, Math.round((task.progress.current / Math.max(1, task.progress.target)) * 100))
    : 0

  async function onClaim() {
    if (!(await claim())) alert(t('tasks.claimFailed'))
  }

  const tone = success
    ? 'border-[#2fbf60] bg-gradient-to-b from-[#0e2d18] to-[#081a0e]'
    : claimable
      ? 'border-[#ffd21d] bg-gradient-to-b from-[#2a1e05] to-[#140e03]'
      : 'border-[#6d480f]/60 bg-gradient-to-b from-[#141009] to-[#0a0906]'

  return (
    <>
      <style>{'@keyframes task-bar-in{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}'}</style>
      <div data-task-bar className="app-fixed-bottom pointer-events-none z-40 px-2" style={{ bottom: bottomOffset }}>
        <div
          className={`pointer-events-auto flex items-center gap-2.5 rounded-[14px] border px-2.5 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.55)] ${tone}`}
          style={{ animation: 'task-bar-in .28s ease-out' }}
        >
          <span
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${success ? 'bg-[radial-gradient(circle_at_38%_30%,#33c96a,#0a9440)] text-white' : 'bg-[#1d1508] text-[#ffd21d]'}`}
          >
            {success ? <Check size={19} strokeWidth={4} /> : <Target size={18} strokeWidth={2.8} />}
          </span>

          <div className="min-w-0 flex-1">
            {success ? (
              <p className="truncate text-[13px] font-black leading-tight text-[#b6f5c9]">
                {reward ? t('tasks.bar.claimed', { reward }) : t('tasks.bar.completed')}
              </p>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="flex-shrink-0 rounded-full bg-[#ffd21d]/15 px-1.5 py-0.5 text-[8px] font-black uppercase leading-none text-[#ffd21d]">
                    {claimable ? t('tasks.bar.readyTag') : t('tasks.bar.doingTag')}
                  </span>
                  <p className="truncate text-[12.5px] font-black leading-tight text-[#fff8ea]">{cardTitle(t, task)}</p>
                </div>
                {/* 达标后进度条必满、已无信息量，让位给打码提示 */}
                {task.progress && !claimable ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[#1c1710]">
                      <div
                        className="h-full rounded-full bg-gradient-to-b from-[#ffe15a] to-[#ffc000] transition-[width] duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-[10.5px] font-black tabular-nums text-[#f0dfc5]">
                      {task.progress.current}/{task.progress.target}
                    </span>
                  </div>
                ) : (
                  <p className="mt-0.5 truncate text-[10.5px] font-medium leading-snug text-[#e8d5b5]">
                    {claimable && task.reward.turnoverX > 0
                      ? t('tasks.bar.turnover', { n: task.reward.turnoverX })
                      : cardSubtitle(t, task)}
                  </p>
                )}
              </>
            )}
          </div>

          {!success && (
            <>
              {claimable ? (
                <button
                  type="button"
                  onClick={() => void onClaim()}
                  disabled={claiming}
                  className="flex-shrink-0 rounded-full bg-gradient-to-b from-[#ffdb37] to-[#ffc400] px-3 py-2 text-[12px] font-black leading-none text-[#241600] shadow-[0_6px_16px_rgba(255,193,17,0.32)] active:scale-95 disabled:opacity-70"
                >
                  {claiming ? t('tasks.claiming') : `${t('tasks.bar.claimNow')}${reward ? ` ${reward}` : ''}`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onReturnToTasks}
                  className="flex-shrink-0 rounded-full border border-[#ffc31e]/50 px-2.5 py-1.5 text-[11px] font-black leading-none text-[#ffd78a] active:scale-95"
                >
                  {t('tasks.bar.backToTasks')}
                </button>
              )}
              <button
                type="button"
                onClick={clear}
                aria-label={t('tasks.bar.close')}
                className="flex-shrink-0 rounded-full p-1 text-[#9c8358] active:scale-90"
              >
                <X size={15} strokeWidth={3} />
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
