import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  buildGamesPath,
  buildTabPath,
  currentReturnTo,
  parseAppRoute,
  type GamesFilter,
  type OverlayNavigateState,
  type TabId,
} from '@/navigation/appRoutes'
import type { FullPageView, TaskInitialPath, VipTab } from '@/hooks/useFullPageOverlay'

function hasSameOriginReferrer() {
  if (typeof document === 'undefined' || !document.referrer) return false
  try {
    return new URL(document.referrer).origin === window.location.origin
  } catch {
    return false
  }
}

export function useAppNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const [backgroundTab, setBackgroundTab] = useState<TabId>('casino')
  const [promoFilter, setPromoFilter] = useState<string | null>(null)
  const [gamesFilter, setGamesFilterState] = useState<GamesFilter>({ cat: 'all', provider: 'all' })
  const [view, setView] = useState<FullPageView>({ type: 'none' })

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/home', { replace: true })
      return
    }
    const parsed = parseAppRoute(location.pathname, location.search)
    if (!parsed) {
      navigate('/home', { replace: true })
      return
    }
    if (parsed.kind === 'tab') {
      setBackgroundTab(parsed.tab)
      setPromoFilter(parsed.promoFilter)
      if (parsed.gamesFilter) setGamesFilterState(parsed.gamesFilter)
      setView({ type: 'none' })
      return
    }
    setView(parsed.overlay)
  }, [location.pathname, location.search, navigate])

  const returnTo = currentReturnTo(location.pathname, location.search)

  const pushOverlay = useCallback((path: string) => {
    navigate(path, { state: { returnTo, pushed: true } satisfies OverlayNavigateState })
  }, [navigate, returnTo])

  const closeOverlayPage = useCallback(() => {
    const state = location.state as OverlayNavigateState | null
    // 应用内压栈打开的浮层：navigate(-1) 精确弹栈。
    // 不能用 navigate(returnTo,{replace})——那会把当前条目替换成 returnTo 的副本，
    // 造成栈里出现两个相同页面（tasks→kyc→返回tasks→再返回还是tasks 的 bug 根因）
    if (state?.pushed && window.history.length > 1) {
      navigate(-1)
      return
    }
    if (state?.returnTo) {
      navigate(state.returnTo, { replace: true })
      return
    }
    if (hasSameOriginReferrer() && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/home', { replace: true })
  }, [location.state, navigate])

  const setNav = useCallback((id: TabId) => {
    navigate(buildTabPath(id))
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [navigate])

  const goHome = useCallback(() => {
    navigate('/home')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [navigate])

  const navigatePath = useCallback((path: string) => {
    if (!path) return
    navigate(path)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [navigate])

  const goBonuses = useCallback((promo: string | null = null) => {
    navigate(buildTabPath('bonuses', promo))
  }, [navigate])

  // 页内切分类/厂商用 replace，避免每次点 chip 都压一条历史记录
  const setGamesFilter = useCallback((filter: Partial<GamesFilter>) => {
    navigate(buildGamesPath(filter), { replace: true })
  }, [navigate])

  const openPerya = useCallback(() => {
    pushOverlay('/perya')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openSearch = useCallback(() => {
    pushOverlay('/search')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  // 旧分类大厅退役后，运营位"看全部/GO BET"跳 games 页对应分类（push 压栈，返回可回原页）
  const goGamesFilter = useCallback((filter: Partial<GamesFilter>) => {
    navigate(buildGamesPath(filter))
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [navigate])

  const openTeamCenter = useCallback(() => {
    pushOverlay('/team')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openAgentCenter = useCallback(() => {
    pushOverlay('/agent')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openBetHistory = useCallback(() => {
    pushOverlay('/bet-history')
  }, [pushOverlay])

  const openLedgerRecords = useCallback(() => {
    pushOverlay('/rewards')
  }, [pushOverlay])

  const openReferralPromo = useCallback(() => {
    pushOverlay('/referral')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openCashback = useCallback(() => {
    pushOverlay('/rebate')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openVipCenter = useCallback((initialTab?: VipTab) => {
    pushOverlay(initialTab ? `/vip?tab=${initialTab}` : '/vip')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openSpin = useCallback(() => {
    pushOverlay('/rewards-spin')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openKycSetting = useCallback(() => {
    pushOverlay('/kyc-setting')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openDownload = useCallback(() => {
    pushOverlay('/download')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pushOverlay])

  const openTasks = useCallback((initialPath?: TaskInitialPath) => {
    pushOverlay(initialPath ? `/tasks?tab=${initialPath}` : '/tasks')
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
    gamesFilter,
    view,
    setNav,
    setGamesFilter,
    goHome,
    navigatePath,
    goBonuses,
    openPerya,
    openSearch,
    goGamesFilter,
    openTeamCenter,
    openAgentCenter,
    openBetHistory,
    openLedgerRecords,
    openReferralPromo,
    openCashback,
    openVipCenter,
    openSpin,
    openKycSetting,
    openDownload,
    openTasks,
    closeImmersive,
    closeOverlay,
    resetToTab,
  }
}
