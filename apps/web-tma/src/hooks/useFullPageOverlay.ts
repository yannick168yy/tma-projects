import { useState } from 'react'

export type CategoryLobbyParams = {
  title: string
  sortCategory?: string
  sortBy?: 'weight' | 'ph_bonus'
  themes?: string[]
  gameStyles?: string[]
  playerTypes?: string[]
  gameUuids?: string[]
}

// 互斥全屏 overlay 的状态机——同一时刻只有一个可见
type FullPageView =
  | { type: 'none' }
  | { type: 'search' }
  | { type: 'slotsLobby' }
  | { type: 'categoryLobby'; params: CategoryLobbyParams }
  | { type: 'teamCenter' }
  | { type: 'betHistory' }
  | { type: 'referralPromo' }
  | { type: 'cashback' }

export function useFullPageOverlay() {
  const [view, setView] = useState<FullPageView>({ type: 'none' })

  return {
    view,
    openSearch:        () => setView({ type: 'search' }),
    openSlotsLobby:    () => setView({ type: 'slotsLobby' }),
    openCategoryLobby: (params: CategoryLobbyParams) => setView({ type: 'categoryLobby', params }),
    openTeamCenter:    () => setView({ type: 'teamCenter' }),
    openBetHistory:    () => setView({ type: 'betHistory' }),
    openReferralPromo: () => setView({ type: 'referralPromo' }),
    openCashback:      () => setView({ type: 'cashback' }),
    close:             () => setView({ type: 'none' }),
    is: (t: FullPageView['type']) => view.type === t,
  }
}
