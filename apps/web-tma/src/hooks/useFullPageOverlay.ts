import { useState } from 'react'

export type VipTab = 'overview' | 'lossrebate' | 'benefits' | 'records'
export type TaskInitialPath = 'newbie' | 'daily' | 'social'

// 互斥全屏 overlay 的状态机——同一时刻只有一个可见
export type FullPageView =
  | { type: 'none' }
  | { type: 'perya' }
  | { type: 'search' }
  | { type: 'teamCenter' }
  | { type: 'agentCenter' }
  | { type: 'betHistory' }
  | { type: 'ledgerRecords' }
  | { type: 'rebate' }
  | { type: 'vipCenter'; initialTab?: VipTab }
  | { type: 'spin' }
  | { type: 'kycSetting' }
  | { type: 'download' }
  | { type: 'tasks'; initialPath?: TaskInitialPath }

/** 全屏专题页：走 document/body 滚动，勿用 fixed + 内部 overflow-y-auto */
export function isImmersiveFullPage(view: FullPageView): boolean {
  return view.type === 'agentCenter'
    || view.type === 'betHistory'
    || view.type === 'ledgerRecords'
    || view.type === 'rebate'
    || view.type === 'vipCenter'
    || view.type === 'spin'
    || view.type === 'kycSetting'
    || view.type === 'download'
    || view.type === 'tasks'
}

export function useFullPageOverlay() {
  const [view, setView] = useState<FullPageView>({ type: 'none' })

  return {
    view,
    openSearch:        () => setView({ type: 'search' }),
    openTeamCenter:    () => setView({ type: 'teamCenter' }),
    openAgentCenter:   () => setView({ type: 'agentCenter' }),
    openBetHistory:    () => setView({ type: 'betHistory' }),
    openLedgerRecords: () => setView({ type: 'ledgerRecords' }),
    openRebate:        () => setView({ type: 'rebate' }),
    openVipCenter:     (initialTab?: VipTab) => setView({ type: 'vipCenter', initialTab }),
    openSpin:          () => setView({ type: 'spin' }),
    openKycSetting:    () => setView({ type: 'kycSetting' }),
    openDownload:      () => setView({ type: 'download' }),
    openTasks:         (initialPath?: TaskInitialPath) => setView({ type: 'tasks', initialPath }),
    close:             () => setView({ type: 'none' }),
    is: (t: FullPageView['type']) => view.type === t,
  }
}
