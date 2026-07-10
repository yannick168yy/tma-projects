import { create } from 'zustand'
import { fetchTaskCenter, claimTask, type TaskCard } from '@/api/tasks'
import { useWalletStore } from '@/stores/wallet'

/** 跳出任务中心后超过此时长仍未完成，视为用户已放弃，自动收起任务条 */
const EXPIRE_MS = 30 * 60 * 1000

interface ActiveTaskState {
  task: TaskCard | null
  startedAt: number
  claiming: boolean
  /** 领取成功 / 聚合卡达成后的庆祝态，由任务条播完动画再 clear */
  success: boolean
}

interface ActiveTaskActions {
  start: (card: TaskCard) => void
  clear: () => void
  sync: () => Promise<void>
  claim: () => Promise<boolean>
}

function findCard(cards: TaskCard[], id: string): TaskCard | undefined {
  return cards.find((c) => c.id === id)
}

export const useActiveTaskStore = create<ActiveTaskState & ActiveTaskActions>((set, get) => ({
  task: null,
  startedAt: 0,
  claiming: false,
  success: false,

  start(card) {
    set({ task: card, startedAt: Date.now(), claiming: false, success: false })
  },

  clear() {
    set({ task: null, startedAt: 0, claiming: false, success: false })
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
    set({ task: next })
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
