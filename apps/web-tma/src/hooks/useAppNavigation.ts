import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  buildCategoryLobbyPath,
  buildTabPath,
  currentReturnTo,
  parseAppRoute,
  type OverlayNavigateState,
  type TabId,
} from '@/navigation/appRoutes'
import type { CategoryLobbyParams, FullPageView } from '@/hooks/useFullPageOverlay'

type NavId = TabId | 'cashier'

export function useAppNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const [backgroundTab, setBackgroundTab] = useState<TabId>('casino')
  const [promoFilter, setPromoFilter] = useState<string | null>(null)
  const [view, setView] = useState<FullPageView>({ type: 'none' })

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/casino', { replace: true })
      return
    }
    const parsed = parseAppRoute(location.pathname, location.search)
    if (!parsed) {
      navigate('/casino', { replace: true })
      return
    }
    if (parsed.kind === 'tab') {
      setBackgroundTab(parsed.tab)
      setPromoFilter(parsed.promoFilter)
      setView({ type: 'none' })
      return
    }
    setView(parsed.overlay)
  }, [location.pathname, location.search, navigate])

  const returnTo = currentReturnTo(location.pathname, location.search)

  const pushOverlay = useCallback((path: string) => {
    navigate(path, { state: { returnTo } satisfies OverlayNavigateState })
  }, [navigate, returnTo])

  const closeOverlayPage = useCallback(() => {
    const state = location.state as OverlayNavigateState | null
    if (state?.returnTo) {
      navigate(state.returnTo, { replace: true })
      return
    }
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/casino', { replace: true })
  }, [location.state, navigate])

  const setNav = useCallback((id: NavId, openWallet: () => void) => {
    if (id === 'cashier') {
      setView({ type: 'none' })
      openWallet()
      return
    }
    navigate(buildTabPath(id))
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [navigate])

  const goHome = useCallback(() => {
    navigate('/casino')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [navigate])

  const goBonuses = useCallback((promo: string | null = null) => {
    navigate(buildTabPath('bonuses', promo))
  }, [navigate])

  const openSearch = useCallback(() => {
    pushOverlay('/search')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openCategoryLobby = useCallback((params: CategoryLobbyParams) => {
    pushOverlay(buildCategoryLobbyPath(params))
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openTeamCenter = useCallback(() => {
    pushOverlay('/team')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openBetHistory = useCallback(() => {
    pushOverlay('/bet-history')
  }, [pushOverlay])

  const openReferralPromo = useCallback(() => {
    pushOverlay('/referral')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openCashback = useCallback(() => {
    pushOverlay('/cashback')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const closeImmersive = useCallback(() => {
    closeOverlayPage()
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [closeOverlayPage])

  const closeOverlay = useCallback(() => {
    closeOverlayPage()
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [closeOverlayPage])

  const resetToTab = useCallback((tab: TabId = backgroundTab) => {
    navigate(buildTabPath(tab), { replace: true })
  }, [backgroundTab, navigate])

  return {
    activeNav: backgroundTab,
    promoFilter,
    view,
    setNav,
    goHome,
    goBonuses,
    openSearch,
    openCategoryLobby,
    openTeamCenter,
    openBetHistory,
    openReferralPromo,
    openCashback,
    closeImmersive,
    closeOverlay,
    resetToTab,
  }
}
