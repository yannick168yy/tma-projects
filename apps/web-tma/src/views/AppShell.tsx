import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Wallet, Gift, Home, Menu, Dices, Headphones } from 'lucide-react'
import BetogoLogo from '@/components/BetogoLogo'
import ProfileAvatar from '@/components/ProfileAvatar'
import WalletModal from '@/components/wallet/WalletModal'
import SearchOverlay from '@/components/search/SearchOverlay'
import HomeContent from '@/views/HomeContent'
import BonusesPage from '@/views/BonusesPage'
import BingoPage from '@/views/BingoPage'
import MenuPage from '@/views/MenuPage'
import ProfilePage from '@/views/ProfilePage'
import SlotsLobby from '@/views/SlotsLobby'
import CustomerServicePage from '@/views/CustomerServicePage'
import TeamCenterPage from '@/views/TeamCenterPage'
import GamePlayer from '@/components/GamePlayer'
import { NAV_ITEMS } from '@/data/home'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { useFullPageOverlay } from '@/hooks/useFullPageOverlay'
import type { CategoryLobbyParams } from '@/hooks/useFullPageOverlay'

type NavId = (typeof NAV_ITEMS)[number]['id']

function navIcon(id: string) {
  switch (id) { case 'cashier': return Wallet; case 'bingo': return Dices; case 'bonuses': return Gift; case 'casino': return Home; default: return Menu }
}

export default function AppShell() {
  const { t } = useTranslation()
  const auth = useAuthStore()
  const wallet = useWalletStore()
  const isLoggedIn = Boolean(auth.token && auth.user)
  const displayPhp = wallet.balance?.displayPhp ?? '₱ —'

  // 互斥全屏 overlay——用状态机显式化互斥关系
  const overlay = useFullPageOverlay()

  const [activeNav, setActiveNav] = useState<NavId>('casino')
  const [promoFilter, setPromoFilter] = useState<string | null>(null)
  const [balanceVisible, setBalanceVisible] = useState(true)
  const [walletOpen, setWalletOpen] = useState(false)
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [csOpen, setCsOpen] = useState(false)
  const [gamePlayerUrl, setGamePlayerUrl] = useState<string | null>(null)

  const headerRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const [headerH, setHeaderH] = useState(80)
  const [navH, setNavH] = useState(64)

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (headerRef.current) setHeaderH(headerRef.current.offsetHeight)
      if (navRef.current) setNavH(navRef.current.offsetHeight)
    })
    if (headerRef.current) ro.observe(headerRef.current)
    if (navRef.current) ro.observe(navRef.current)
    return () => ro.disconnect()
  }, [])

  const mainStyle = useMemo(() => {
    const top = `${headerH}px`
    if (overlay.is('profile')) return { paddingTop: top, paddingBottom: '0', height: `calc(100dvh - ${headerH}px)`, maxHeight: `calc(100dvh - ${headerH}px)` }
    if (overlay.is('teamCenter')) return { paddingTop: top, paddingBottom: `${navH}px`, height: `calc(100dvh - ${headerH}px)`, maxHeight: `calc(100dvh - ${headerH}px)`, overflowY: 'hidden' as const }
    return { paddingTop: top, paddingBottom: `${navH}px` }
  }, [headerH, navH, overlay])

  async function openWallet() {
    if (!(await auth.ensureLoggedIn(t('auth.signInDepositWithdraw')))) return
    setWalletOpen(false); setWalletModalOpen(true)
  }

  async function onBalanceTap() {
    if (!isLoggedIn) { await auth.ensureLoggedIn(t('auth.signInBalance')); return }
    if (!walletOpen) void wallet.refresh()
    setWalletOpen(!walletOpen)
  }

  async function openProfile() {
    if (!(await auth.ensureLoggedIn(t('auth.signInProfile')))) return
    setWalletOpen(false); overlay.openProfile()
    requestAnimationFrame(() => { mainRef.current?.scrollTo({ top: 0 }); window.scrollTo({ top: 0, behavior: 'instant' }) })
  }

  async function onGameTap() { await auth.ensureLoggedIn(t('auth.signInPlay')) }

  const goBonuses = useCallback((promo: string | null = null) => {
    setPromoFilter(promo); setActiveNav('bonuses'); overlay.close()
  }, [overlay])

  function setNav(id: NavId) {
    if (id === 'cashier') { overlay.close(); void openWallet(); return }
    setActiveNav(id); overlay.close()
    if (id !== 'bonuses') setPromoFilter(null)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function goHome() {
    setActiveNav('casino'); overlay.close(); setPromoFilter(null)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function openSearch() {
    setWalletOpen(false); overlay.openSearch()
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function openCategoryLobby(params: CategoryLobbyParams) {
    setWalletOpen(false); overlay.openCategoryLobby(params)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function openCs() { overlay.close(); setWalletOpen(false); setCsOpen(true) }
  function openTeamCenter() { setWalletOpen(false); overlay.openTeamCenter() }
  function onLogout() { overlay.close(); setWalletOpen(false); setWalletModalOpen(false) }

  const navItems = useMemo(() => NAV_ITEMS.map((item) => ({ ...item, label: t(`nav.${item.id}`) })), [t])

  const { view } = overlay

  return (
    <div className="flex w-full justify-center bg-[#040609]">
      <div className="app-frame w-full max-w-[430px] bg-background">
        <header ref={headerRef} className="app-fixed-top bg-background">
          <div className="app-safe-header flex items-center gap-3 px-4 pb-4">
            <button type="button" className="flex-shrink-0 cursor-pointer" onClick={goHome}><BetogoLogo /></button>

            <div className="flex flex-1 items-center justify-center gap-3">
              <button type="button" className="flex flex-col items-center gap-0.5" onClick={() => void onBalanceTap()}>
                <span className="flex items-center gap-1 text-[11px] font-semibold leading-none text-muted-foreground">
                  {isLoggedIn ? 'PHP' : t('shell.signIn')}
                  {isLoggedIn && <ChevronDown size={11} className={`transition-transform duration-200 ${walletOpen ? 'rotate-180' : ''}`} />}
                </span>
                <span className="text-base font-black leading-tight text-white">
                  {isLoggedIn ? (balanceVisible ? displayPhp : '₱ ••••••') : t('shell.tapToLogin')}
                </span>
              </button>
              {isLoggedIn && (
                <button type="button" className="flex items-center gap-1 whitespace-nowrap rounded-full bg-primary px-5 py-2 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/30 transition-colors hover:bg-yellow-400" onClick={() => void openWallet()}>{t('shell.topUp')}</button>
              )}
            </div>

            <button type="button" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary transition-colors" onClick={openCs}><Headphones size={20} /></button>
            <button type="button" className="relative flex-shrink-0" onClick={() => void openProfile()}>
              <ProfileAvatar />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent" />
            </button>
          </div>

          {walletOpen && isLoggedIn && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setWalletOpen(false)} />
              <div className="absolute left-4 right-4 top-full z-50 -mt-1 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
                <div className="p-4">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('shell.myWallet')}</p>
                  <div className="flex items-center justify-between border-b border-border py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><span className="text-sm font-black text-primary">₱</span></div>
                      <div><p className="text-sm font-bold text-foreground">{t('shell.philippinePeso')}</p><p className="text-xs text-muted-foreground">PHP</p></div>
                    </div>
                    <span className="text-base font-black text-primary">
                      {balanceVisible ? (wallet.balance?.availableCents ?? 0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}) : '••••••'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary"><span className="text-sm font-black text-muted-foreground">₮</span></div>
                      <div><p className="text-sm font-bold text-foreground">{t('shell.tetherUsd')}</p><p className="text-xs text-muted-foreground">USDT · Coming Soon</p></div>
                    </div>
                    <span className="text-sm font-bold text-muted-foreground">—</span>
                  </div>
                </div>
                <div className="flex gap-2 px-4 pb-4">
                  <button type="button" className="flex-1 rounded-xl bg-secondary py-2 text-xs font-bold text-muted-foreground" onClick={() => setBalanceVisible(!balanceVisible)}>{balanceVisible ? t('shell.hideBalances') : t('shell.showBalances')}</button>
                  <button type="button" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-yellow-400" onClick={() => void openWallet()}><Wallet size={13} />{t('shell.wallet')}</button>
                </div>
              </div>
            </>
          )}
        </header>

        <main
          ref={mainRef}
          className={view.type === 'profile' ? 'page-scroll hide-scrollbar overflow-x-hidden' : 'relative overflow-x-clip'}
          style={mainStyle}
        >
          {view.type === 'search' && (
            <SearchOverlay onClose={() => { overlay.close(); window.scrollTo({ top: 0, behavior: 'instant' }) }} onGameTap={() => void onGameTap()} onOpenGame={(url) => setGamePlayerUrl(url)} />
          )}
          {view.type === 'slotsLobby' && (
            <SlotsLobby onClose={() => { overlay.close(); window.scrollTo({ top: 0, behavior: 'instant' }) }} onGameTap={() => void onGameTap()} onOpenGame={(url) => setGamePlayerUrl(url)} />
          )}
          {view.type === 'categoryLobby' && (
            <SlotsLobby {...view.params} onClose={() => { overlay.close(); window.scrollTo({ top: 0, behavior: 'instant' }) }} onGameTap={() => void onGameTap()} onOpenGame={(url) => setGamePlayerUrl(url)} />
          )}
          {view.type === 'profile' && <ProfilePage onLogout={onLogout} onOpenCs={openCs} />}
          {view.type === 'teamCenter' && <TeamCenterPage onClose={overlay.close} />}
          {view.type === 'none' && activeNav === 'bonuses' && <BonusesPage promoFilter={promoFilter} onOpenWallet={() => void openWallet()} onOpenTeam={openTeamCenter} />}
          {view.type === 'none' && activeNav === 'bingo' && <BingoPage onOpenWallet={() => void openWallet()} onGameTap={() => void onGameTap()} onOpenGame={(url) => setGamePlayerUrl(url)} onOpenCategoryLobby={openCategoryLobby} />}
          {view.type === 'none' && activeNav === 'menu' && <MenuPage onOpenSearch={openSearch} onOpenCs={openCs} onOpenCategoryLobby={openCategoryLobby} />}
          {view.type === 'none' && activeNav === 'casino' && (
            <HomeContent onOpenSearch={openSearch} onOpenPromo={goBonuses} onOpenCategoryLobby={openCategoryLobby} onOpenCs={openCs} onOpenGame={(url) => setGamePlayerUrl(url)} />
          )}
        </main>

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
      </div>

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
    </div>
  )
}
