import { useState } from 'react'

export type CategoryLobbyParams = {
  title: string
  sortCategory?: string
  siteCategory?: string
  provider?: string
  sortBy?: 'weight' | 'ph_bonus'
  themes?: string[]
  gameStyles?: string[]
  playerTypes?: string[]
  gameUuids?: string[]
}

// 互斥全屏 overlay 的状态机——同一时刻只有一个可见
export type FullPageView =
  | { type: 'none' }
  | { type: 'search' }
  | { type: 'slotsLobby' }
  | { type: 'categoryLobby'; params: CategoryLobbyParams }
  | { type: 'teamCenter' }
  | { type: 'agentCenter' }
  | { type: 'betHistory' }
  | { type: 'ledgerRecords' }
  | { type: 'cashback' }
  | { type: 'spin' }
  | { type: 'kycSetting' }
  | { type: 'download' }

/** 全屏专题页：走 document/body 滚动，勿用 fixed + 内部 overflow-y-auto */
export function isImmersiveFullPage(view: FullPageView): boolean {
  return view.type === 'agentCenter'
    || view.type === 'betHistory'
    || view.type === 'ledgerRecords'
    || view.type === 'cashback'
    || view.type === 'spin'
    || view.type === 'kycSetting'
    || view.type === 'download'
}

export function useFullPageOverlay() {
  const [view, setView] = useState<FullPageView>({ type: 'none' })

  return {
    view,
    openSearch:        () => setView({ type: 'search' }),
    openSlotsLobby:    () => setView({ type: 'slotsLobby' }),
    openCategoryLobby: (params: CategoryLobbyParams) => setView({ type: 'categoryLobby', params }),
    openTeamCenter:    () => setView({ type: 'teamCenter' }),
    openAgentCenter:   () => setView({ type: 'agentCenter' }),
    openBetHistory:    () => setView({ type: 'betHistory' }),
    openLedgerRecords: () => setView({ type: 'ledgerRecords' }),
    openCashback:      () => setView({ type: 'cashback' }),
    openSpin:          () => setView({ type: 'spin' }),
    openKycSetting:    () => setView({ type: 'kycSetting' }),
    openDownload:      () => setView({ type: 'download' }),
    close:             () => setView({ type: 'none' }),
    is: (t: FullPageView['type']) => view.type === t,
  }
}
