import { lazy, Suspense, useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronLeft, Wallet, Gift, Home, Menu, Dices, Check, Search } from 'lucide-react'
import BetogoLogo from '@/components/BetogoLogo'
import { NAV_ITEMS } from '@/data/home'
import { useAuthStore } from '@/stores/auth'
import {
  useWalletStore,
  formatHeaderBalance,
  formatBalanceWithCode,
  SUPPORTED_CURRENCY_CODES,
  isFiatCurrency,
  displayCurrencyCode,
} from '@/stores/wallet'
import { isImmersiveFullPage } from '@/hooks/useFullPageOverlay'
import { useAppNavigation } from '@/hooks/useAppNavigation'

const WalletModal = lazy(() => import('@/components/wallet/WalletModal'))
const SearchOverlay = lazy(() => import('@/components/search/SearchOverlay'))
const HomeContent = lazy(() => import('@/views/HomeContent'))
const BonusesPage = lazy(() => import('@/views/BonusesPage'))
const BingoPage = lazy(() => import('@/views/BingoPage'))
const MenuPage = lazy(() => import('@/views/MenuPage'))
const SlotsLobby = lazy(() => import('@/views/SlotsLobby'))
const CustomerServicePage = lazy(() => import('@/views/CustomerServicePage'))
const TeamCenterPage = lazy(() => import('@/views/TeamCenterPage'))
const AgentCenterPage = lazy(() => import('@/views/AgentCenterPage'))
const BetHistoryPage = lazy(() => import('@/views/BetHistoryPage'))
const LedgerRecordsPage = lazy(() => import('@/views/LedgerRecordsPage'))
const ReferralPromoPage = lazy(() => import('@/views/ReferralPromoPage'))
const CashbackPage = lazy(() => import('@/views/CashbackPage'))
const RewardsSpinPage = lazy(() => import('@/views/RewardsSpinPage'))
const GamePlayer = lazy(() => import('@/components/GamePlayer'))

type NavId = (typeof NAV_ITEMS)[number]['id']

function navIcon(id: string) {
  switch (id) { case 'cashier': return Wallet; case 'bingo': return Dices; case 'bonuses': return Gift; case 'casino': return Home; default: return Menu }
}

export default function AppShell() {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const wallet = useWalletStore()
  const isLoggedIn = Boolean(auth.token && auth.user)
  const activeCurrency = wallet.activeCurrency

  // 合并预设 8 个币种 + 实际余额（余额为 0 的也显示）
  const allBalances = useMemo(() => {
    const actualMap = new Map((wallet.balance?.balances ?? []).map((b) => [b.currency, b.available]))
    const list = (SUPPORTED_CURRENCY_CODES as readonly string[]).map((code) => ({
      code,
      available: actualMap.get(code) ?? 0,
    }))
    // TRX_TESTNET：若用户有余额则插在 TRX 后
    if (actualMap.has('TRX_TESTNET')) {
      const idx = list.findIndex((r) => r.code === 'TRX')
      list.splice(idx + 1, 0, { code: 'TRX_TESTNET', available: actualMap.get('TRX_TESTNET') ?? 0 })
    }
    return list
  }, [wallet.balance?.balances])

  const activeAvailable = allBalances.find((b) => b.code === activeCurrency)?.available ?? 0
  const displayBalance = wallet.balance
    ? formatHeaderBalance(activeCurrency, activeAvailable)
    : (activeCurrency === 'PHP' ? '₱ —' : '—')

  const nav = useAppNavigation()
  const {
    activeNav,
    promoFilter,
    view,
    setNav: navigateTab,
    goHome,
    goBonuses,
    openSearch,
    openCategoryLobby,
    openTeamCenter,
    openAgentCenter,
    openBetHistory,
    openLedgerRecords,
    openReferralPromo,
    openCashback,
    openSpin,
    closeImmersive,
    closeOverlay,
    resetToTab,
  } = nav
  const isImmersive = isImmersiveFullPage(view)
  const [balanceVisible, setBalanceVisible] = useState(true)
  const [walletOpen, setWalletOpen] = useState(false)
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [csOpen, setCsOpen] = useState(false)
  const [gamePlayerUrl, setGamePlayerUrl] = useState<string | null>(null)

  const headerRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const balanceTriggerRef = useRef<HTMLButtonElement>(null)
  const walletPanelRef = useRef<HTMLDivElement>(null)
  const [headerH, setHeaderH] = useState(80)
  const [navH, setNavH] = useState(64)

  const fiatBalances = useMemo(() => allBalances.filter((b) => isFiatCurrency(b.code)), [allBalances])
  const cryptoBalances = useMemo(() => allBalances.filter((b) => !isFiatCurrency(b.code)), [allBalances])

  useEffect(() => {
    if (!walletOpen) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (walletPanelRef.current?.contains(target)) return
      if (balanceTriggerRef.current?.contains(target)) return
      setWalletOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [walletOpen])

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (headerRef.current) setHeaderH(headerRef.current.offsetHeight)
      if (navRef.current) setNavH(navRef.current.offsetHeight)
    })
    if (headerRef.current) ro.observe(headerRef.current)
    if (navRef.current) ro.observe(navRef.current)
    return () => ro.disconnect()
  }, [])

  // 供子页面 sticky 使用；全屏专题页无 AppShell header
  useEffect(() => {
    document.documentElement.style.setProperty('--app-header-height', isImmersive ? '0px' : `${headerH}px`)
  }, [headerH, isImmersive])

  const mainStyle = useMemo(() => {
    if (isImmersive) return undefined
    return { paddingTop: `${headerH}px`, paddingBottom: `${navH}px` }
  }, [headerH, navH, isImmersive])

  async function openWallet() {
    if (!(await auth.ensureLoggedIn(t('auth.signInDepositWithdraw')))) return
    setWalletOpen(false); setWalletModalOpen(true)
  }

  async function onBalanceTap() {
    if (!isLoggedIn) { await auth.ensureLoggedIn(t('auth.signInBalance')); return }
    if (!walletOpen) void wallet.refresh()
    setWalletOpen(!walletOpen)
  }

  async function onGameTap() { await auth.ensureLoggedIn(t('auth.signInPlay')) }

  function setNav(id: NavId) {
    setWalletOpen(false)
    navigateTab(id, () => { void openWallet() })
  }

  function onOpenSearch() {
    setWalletOpen(false)
    openSearch()
  }

  function onOpenCategoryLobby(params: Parameters<typeof openCategoryLobby>[0]) {
    setWalletOpen(false)
    openCategoryLobby(params)
  }

  function onOpenTeamCenter() {
    setWalletOpen(false)
    openTeamCenter()
  }

  function onOpenAgentCenter() {
    setWalletOpen(false)
    openAgentCenter()
  }

  function onOpenBetHistory() {
    setWalletOpen(false)
    openBetHistory()
  }

  function onOpenLedgerRecords() {
    setWalletOpen(false)
    openLedgerRecords()
  }

  function onOpenReferralPromo() {
    setWalletOpen(false)
    openReferralPromo()
  }

  function onOpenCashback() {
    setWalletOpen(false)
    openCashback()
  }

  async function onOpenSpin() {
    setWalletOpen(false)
    if (!(await auth.ensureLoggedIn(t('auth.signInBonus')))) return
    openSpin()
  }

  function openCs() { closeOverlay(); setWalletOpen(false); setCsOpen(true) }
  function onLogout() { resetToTab('menu'); setWalletOpen(false); setWalletModalOpen(false) }

  const navItems = useMemo(() => NAV_ITEMS.map((item) => ({ ...item, label: t(`nav.${item.id}`) })), [t])

  useEffect(() => {
    const tg = window.Telegram?.WebApp
    if (!tg?.BackButton || gamePlayerUrl) return
    const showBack = view.type !== 'none'
    if (!showBack) {
      tg.BackButton.hide()
      return
    }
    tg.BackButton.show()
    tg.BackButton.onClick(closeOverlay)
    return () => {
      tg.BackButton?.offClick(closeOverlay)
      tg.BackButton?.hide()
    }
  }, [view.type, gamePlayerUrl, closeOverlay])

  function renderCurrencyRow(b: { code: string; available: number }) {
    const isActive = b.code === activeCurrency
    return (
      <button
        key={b.code}
        type="button"
        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${isActive ? 'bg-primary/6' : 'hover:bg-white/4'}`}
        onClick={() => {
          wallet.setActiveCurrency(b.code)
          setWalletOpen(false)
        }}
      >
        <div className="flex items-center gap-1">
          <span className={`text-xs font-bold ${isActive ? 'text-primary' : 'text-foreground'}`}>
            {displayCurrencyCode(b.code)}
          </span>
          {b.code === 'TRX_TESTNET' && <sup className="text-[8px] font-bold leading-none text-yellow-400">TEST</sup>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-bold tabular-nums ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
            {balanceVisible ? formatBalanceWithCode(b.code, b.available) : '••••••'}
          </span>
          {isActive && <Check size={11} className="flex-shrink-0 text-primary" />}
        </div>
      </button>
    )
  }

  return (
    <div className="flex w-full justify-center bg-background">
      <div className="app-frame w-full max-w-[430px] bg-background">
        {!isImmersive && (
        <header ref={headerRef} className={`app-fixed-top bg-background ${walletOpen ? 'z-50' : ''}`}>
          <div className="app-safe-header flex items-center gap-3 px-4 pb-4">
            <button type="button" className="flex-shrink-0 cursor-pointer" onClick={goHome}><BetogoLogo /></button>

            <div className="flex flex-1 items-center justify-center gap-3">
              <button ref={balanceTriggerRef} type="button" className="flex flex-col items-center gap-0.5" onClick={() => void onBalanceTap()}>
                <span className="flex items-center gap-1 text-[11px] font-semibold leading-none text-muted-foreground">
                  {isLoggedIn ? activeCurrency : t('shell.signIn')}
                  {isLoggedIn && <ChevronDown size={11} className={`transition-transform duration-200 ${walletOpen ? 'rotate-180' : ''}`} />}
                </span>
                <span className="text-base font-black leading-tight text-foreground">
                  {isLoggedIn ? (balanceVisible ? displayBalance : '••••••') : t('shell.tapToLogin')}
                </span>
              </button>
              {isLoggedIn && (
                <button type="button" className="flex items-center gap-1 whitespace-nowrap rounded-full bg-primary px-5 py-2 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/30 transition-colors hover:bg-yellow-400" onClick={() => void openWallet()}>{t('shell.topUp')}</button>
              )}
            </div>

            <button
              type="button"
              className="flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground hover:bg-white/10 active:scale-95 transition-all"
              onClick={onOpenSearch}
            >
              <Search size={18} />
            </button>

            <button
              type="button"
              className="relative flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-amber-500/30 hover:bg-yellow-400 active:scale-95 transition-all"
              onClick={openCs}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                {/* 头带弧 */}
                <path d="M3.5 10C3.5 6.41 6.41 3.5 10 3.5s6.5 2.91 6.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                {/* 左耳罩 */}
                <rect x="2" y="10" width="3.5" height="5.5" rx="1.75" fill="currentColor"/>
                {/* 右耳罩 */}
                <rect x="14.5" y="10" width="3.5" height="5.5" rx="1.75" fill="currentColor"/>
                {/* 话筒悬臂 */}
                <path d="M16.25 15.2c0 1.2-.8 2-2.25 2.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                {/* 话筒头 */}
                <circle cx="14" cy="17.6" r="0.9" fill="currentColor"/>
              </svg>
              {/* 在线状态 */}
            </button>
          </div>

          {walletOpen && isLoggedIn && (
            <>
              <div
                ref={walletPanelRef}
                className="absolute left-4 right-4 top-full z-[60] -mt-1 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
              >
                <div className="px-4 pt-4 pb-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('shell.myWallet')}</p>
                  <div className="mb-3 flex items-center justify-between rounded-xl border border-primary/15 bg-primary/8 px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-black text-primary">{displayCurrencyCode(activeCurrency)}</span>
                      {activeCurrency === 'TRX_TESTNET' && <sup className="text-[9px] font-bold leading-none text-yellow-400">TEST</sup>}
                    </div>
                    <span className="text-lg font-black tabular-nums text-primary">
                      {balanceVisible ? formatBalanceWithCode(activeCurrency, activeAvailable) : '••••••'}
                    </span>
                  </div>

                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('shell.switchCurrency')}</p>

                  {fiatBalances.length > 0 && (
                    <div className="mb-2">
                      <p className="mb-1 px-2 text-[10px] font-semibold text-muted-foreground/80">{t('shell.fiatCurrencies')}</p>
                      <div className="space-y-0.5">
                        {fiatBalances.map((b) => renderCurrencyRow(b))}
                      </div>
                    </div>
                  )}

                  {cryptoBalances.length > 0 && (
                    <div>
                      <p className="mb-1 px-2 text-[10px] font-semibold text-muted-foreground/80">{t('shell.cryptoCurrencies')}</p>
                      <div className="space-y-0.5">
                        {cryptoBalances.map((b) => renderCurrencyRow(b))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 px-4 pb-4">
                  <button type="button" className="flex-1 rounded-xl bg-secondary py-2 text-xs font-bold text-muted-foreground" onClick={() => setBalanceVisible(!balanceVisible)}>{balanceVisible ? t('shell.hideBalances') : t('shell.showBalances')}</button>
                  <button type="button" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-yellow-400" onClick={() => void openWallet()}><Wallet size={13} />{t('shell.wallet')}</button>
                </div>
              </div>
            </>
          )}
        </header>
        )}

        <main
          ref={mainRef}
          className="relative overflow-x-clip"
          style={mainStyle}
        >
          <Suspense fallback={null}>
          {view.type === 'search' && (
            <SearchOverlay onClose={closeOverlay} onGameTap={() => void onGameTap()} onOpenGame={(url) => setGamePlayerUrl(url)} />
          )}
          {view.type === 'slotsLobby' && (
            <SlotsLobby onClose={closeOverlay} onGameTap={() => void onGameTap()} onOpenGame={(url) => setGamePlayerUrl(url)} />
          )}
          {view.type === 'categoryLobby' && (
            <SlotsLobby {...view.params} onClose={closeOverlay} onGameTap={() => void onGameTap()} onOpenGame={(url) => setGamePlayerUrl(url)} />
          )}
          {view.type === 'teamCenter' && (
            <div className="app-safe-header">
              <TeamCenterPage onClose={closeImmersive} />
            </div>
          )}
          {view.type === 'agentCenter' && (
            <div className="app-safe-header">
              <AgentCenterPage onClose={closeImmersive} />
            </div>
          )}
          {view.type === 'betHistory' && (
            <div className="app-safe-header">
              <BetHistoryPage onClose={closeImmersive} />
            </div>
          )}
          {view.type === 'ledgerRecords' && (
            <div className="app-safe-header">
              <LedgerRecordsPage onClose={closeImmersive} />
            </div>
          )}
          {view.type === 'referralPromo' && (
            <div className="relative">
              <button
                type="button"
                className="cashback-back-btn absolute left-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm border border-white/15 active:scale-95 transition-transform"
                onClick={closeImmersive}
              >
                <ChevronLeft size={20} />
              </button>
              <ReferralPromoPage onOpenTeamCenter={onOpenTeamCenter} />
            </div>
          )}
          {view.type === 'cashback' && (
            <div className="relative">
              <button
                type="button"
                className="cashback-back-btn absolute left-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm border border-white/15 active:scale-95 transition-transform"
                onClick={closeImmersive}
              >
                <ChevronLeft size={20} />
              </button>
              <CashbackPage onOpenGame={(url) => setGamePlayerUrl(url)} onOpenCategory={onOpenCategoryLobby} />
            </div>
          )}
          {view.type === 'spin' && (
            <RewardsSpinPage onClose={closeImmersive} />
          )}
          {view.type === 'none' && activeNav === 'bonuses' && <BonusesPage promoFilter={promoFilter} onOpenWallet={() => void openWallet()} onOpenTeam={onOpenTeamCenter} />}
          {view.type === 'none' && activeNav === 'bingo' && <BingoPage onOpenWallet={() => void openWallet()} onGameTap={() => void onGameTap()} onOpenGame={(url) => setGamePlayerUrl(url)} onOpenCategoryLobby={onOpenCategoryLobby} />}
          {view.type === 'none' && activeNav === 'menu' && <MenuPage onOpenCs={openCs} onLogin={() => void auth.ensureLoggedIn(t('auth.signInProfile'))} onLogout={onLogout} onOpenBetHistory={onOpenBetHistory} onOpenLedgerRecords={onOpenLedgerRecords} onOpenReferralPromo={onOpenReferralPromo} onOpenAgentCenter={onOpenAgentCenter} />}
          {view.type === 'none' && activeNav === 'casino' && (
            <HomeContent onOpenPromo={goBonuses} onOpenCategoryLobby={onOpenCategoryLobby} onOpenCs={openCs} onOpenGame={(url) => setGamePlayerUrl(url)} onOpenReferralPromo={onOpenReferralPromo} onOpenCashback={onOpenCashback} onOpenSpin={() => void onOpenSpin()} />
          )}
          </Suspense>
        </main>

        {!isImmersive && (
        <nav ref={navRef} className="app-fixed-bottom app-safe-nav flex items-center justify-around border-t border-border bg-background px-2 pt-2">
          {navItems.map((item) => {
            const Icon = navIcon(item.id)
            return (
              <button key={item.id} type="button" className={`relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 transition-colors ${activeNav === item.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setNav(item.id)}>
                {activeNav === item.id && <span className="absolute -top-2 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-primary" />}
                <div className={activeNav === item.id ? 'rounded-xl bg-primary/10 p-1.5' : 'p-1.5'}><Icon size={20} /></div>
                {'badge' in item && item.badge && (
                  <span className="absolute right-1 top-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-black text-white">{item.badge}</span>
                )}
                <span className="text-[10px] font-bold leading-none">{item.label}</span>
              </button>
            )
          })}
        </nav>
        )}
      </div>

      <Suspense fallback={null}>
        {walletModalOpen && (
          <WalletModal open onClose={() => setWalletModalOpen(false)} />
        )}

        {csOpen && (
          <div className="fixed inset-0 z-[60] flex justify-center">
            <div className="w-full max-w-[430px] bg-background flex flex-col overflow-hidden">
              <CustomerServicePage onClose={() => setCsOpen(false)} />
            </div>
          </div>
        )}

        {gamePlayerUrl && <GamePlayer url={gamePlayerUrl} onClose={() => setGamePlayerUrl(null)} />}
      </Suspense>
    </div>
  )
}
