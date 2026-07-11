import { create } from 'zustand'
import { fetchTaskCenter, claimTask, type TaskCard } from '@/api/tasks'
import { useWalletStore } from '@/stores/wallet'

/** 跳出任务中心后超过此时长仍未完成，视为用户已放弃，自动收起任务条 */
const EXPIRE_MS = 30 * 60 * 1000

interface ActiveTaskState {
  task: TaskCard | null
  startedAt: number
  claiming: boolean
  /** 领取成功 / 聚合卡达成后的庆祝态，由任务条播完动画再 advance 接力下一个 */
  success: boolean
  /** 刚从上一个任务接力过来（任务条显示"下一个"标签，首次轮询后复位） */
  advanced: boolean
}

interface ActiveTaskActions {
  start: (card: TaskCard) => void
  clear: () => void
  sync: () => Promise<void>
  claim: () => Promise<boolean>
  /** 庆祝动画播完后调用：接力同组优先的下一个未完成任务，无任务可接则收起 */
  advance: () => Promise<void>
}

function findCard(cards: TaskCard[], id: string): TaskCard | undefined {
  return cards.find((c) => c.id === id)
}

export const useActiveTaskStore = create<ActiveTaskState & ActiveTaskActions>((set, get) => ({
  task: null,
  startedAt: 0,
  claiming: false,
  success: false,
  advanced: false,

  start(card) {
    set({ task: card, startedAt: Date.now(), claiming: false, success: false, advanced: false })
  },

  clear() {
    set({ task: null, startedAt: 0, claiming: false, success: false, advanced: false })
  },

  async sync() {
    const { task, success, startedAt } = get()
    if (!task || success) return
    if (Date.now() - startedAt > EXPIRE_MS) { get().clear(); return }

    let center
    try { center = await fetchTaskCenter() } catch { return }
    const g = center.groups
    const next = findCard([...g.newbie, ...g.daily, ...g.achievement, ...g.social], task.id)
    if (!next) { get().clear(); return }

    // 聚合卡（agg_*）没有 claim 动作，达成的唯一信号是 status=done
    if (next.status === 'done') { set({ task: next, success: true }); return }
    set({ task: next }) // advanced 标签保持到任务切换（start/advance/clear），不被轮询复位
  },

  async advance() {
    const { task } = get()
    let center
    try { center = await fetchTaskCenter() } catch { get().clear(); return }
    const g = center.groups
    const ordered = [...g.newbie, ...g.daily, ...g.achievement, ...g.social]
    // 同组优先接力，组内顺序即展示顺序
    const pool = task
      ? [...ordered.filter((c) => c.group === task.group), ...ordered.filter((c) => c.group !== task.group)]
      : ordered
    const next = pool.find((c) => c.status !== 'done' && c.id !== task?.id)
    if (next) set({ task: next, startedAt: Date.now(), claiming: false, success: false, advanced: true })
    else get().clear()
  },

  async claim() {
    const { task, claiming } = get()
    if (!task || claiming) return false
    set({ claiming: true })
    try {
      await claimTask(task.id)
      set({ success: true })
      await useWalletStore.getState().refresh()
      return true
    } catch {
      return false
    } finally {
      set({ claiming: false })
    }
  },
}))

/** 原生任务达标：聚合卡未完成时 status 也是 claimable，必须同时看 action.kind */
export function isClaimableNow(task: TaskCard): boolean {
  return task.status === 'claimable' && task.action.kind === 'claim'
}
