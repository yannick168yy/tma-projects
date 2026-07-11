import { apiRequest } from '@/api/client'

export type TaskGroup = 'newbie' | 'daily' | 'achievement' | 'social'
export type RewardType = 'cash' | 'spin' | 'growth'
export type TaskStatus = 'locked' | 'claimable' | 'done'
export type TaskActionKind = 'claim' | 'goto' | 'code_redeem' | 'manual_review' | 'open_module'

export interface TaskReward {
  type: RewardType
  amount: number
  spin: number
  currency: string
  turnoverX: number
}

export interface TaskCard {
  id: string
  group: TaskGroup
  title: string
  subtitle: string
  status: TaskStatus
  reward: TaskReward
  progress?: { current: number; target: number }
  action: { kind: TaskActionKind; url?: string; target?: string; verifyStrategy?: string }
}

export interface TaskCenter {
  groups: {
    newbie: TaskCard[]
    daily: TaskCard[]
    achievement: TaskCard[]
    social: TaskCard[]
  }
}

export async function fetchTaskCenter(): Promise<TaskCenter> {
  return apiRequest<TaskCenter>('/tasks')
}

/** 模块弹层（签到/体验金/充值/装机）关闭后广播，任务中心据此刷新状态 */
export const TASKS_REFRESH_EVENT = 'betogo:tasks-refresh'
export function notifyTasksRefresh(): void {
  window.dispatchEvent(new Event(TASKS_REFRESH_EVENT))
}

export interface ClaimResult {
  taskId: string
  reward: TaskReward
}

export async function claimTask(taskId: string): Promise<ClaimResult> {
  return apiRequest<ClaimResult>(`/tasks/${encodeURIComponent(taskId)}/claim`, { method: 'POST' })
}

export interface SocialClaimResult {
  status: 'claimed' | 'pending_review'
  reward?: TaskReward
}

/** 社群任务领取：code_redeem 传 code；manual_review 传 screenshotUrl */
export async function claimSocialTask(
  taskKey: string,
  input: { code?: string; screenshotUrl?: string } = {},
): Promise<SocialClaimResult> {
  return apiRequest<SocialClaimResult>(`/tasks/social/${encodeURIComponent(taskKey)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}
