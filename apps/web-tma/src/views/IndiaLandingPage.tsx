import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check, ChevronRight, Download, Eye, EyeOff, Gift,
  Headphones, IndianRupee, Loader2, LockKeyhole, Phone, ShieldCheck,
  Sparkles, WalletCards,
} from 'lucide-react'
import SiteLogo from '@/components/SiteLogo'
import { fetchNewPlayerSummary, type NewPlayerSummary } from '@/api/promotion'
import { fetchHomepageGames, type SlotGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'
import { useWalletStore } from '@/stores/wallet'
import { TURNSTILE_SITE_KEY, loadTurnstile } from '@/utils/turnstile'
import { translateApiError } from '@/utils/translateApiError'
import { analytics } from '@/utils/analytics'
import { isFeatureEnabled } from '@/config/features'
import { useTranslation } from 'react-i18next'
import coinsGift from '@/assets/home/raw/coins-gift.png'

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const TRIAL_DEVICE_BLOCKED_KEY = 'betogo_landing_trial_device_blocked'

function money(amount: number) {
  return `₹${INR.format(amount)}`
}

function LandingRegisterForm({ bonus }: { bonus: number }) {
  const { t } = useTranslation()
  const register = useAuthStore((s) => s.registerWithPassword)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captchaArmed, setCaptchaArmed] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | undefined>()
  const [captchaError, setCaptchaError] = useState(false)
  const captchaRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<string | null>(null)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !captchaArmed || widgetRef.current) return
    let cancelled = false
    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !captchaRef.current || widgetRef.current) return
        widgetRef.current = turnstile.render(captchaRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          retry: 'auto',
          callback: (token) => { setCaptchaToken(token); setCaptchaError(false) },
          'expired-callback': () => setCaptchaToken(undefined),
          'error-callback': () => { setCaptchaToken(undefined); setCaptchaError(true) },
        })
      })
      .catch(() => { if (!cancelled) setCaptchaError(true) })
    return () => { cancelled = true }
  }, [captchaArmed])

  async function onSubmit() {
    const digits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit Indian mobile number.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    setError(null)
    analytics.landingAction('register_submit', 'guest')
    try {
      await register('phone', `+91${digits}`, password, undefined, captchaToken)
    } catch (e) {
      setError(e instanceof Error ? translateApiError(e.message, t) : 'Registration failed. Please try again.')
      if (e instanceof Error && e.message === 'errors.captchaFailed' && widgetRef.current) {
        setCaptchaToken(undefined)
        window.turnstile?.reset(widgetRef.current)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div id="landing-register" className="relative overflow-hidden rounded-[24px] border border-[#f7c94b]/25 bg-[#121522]/95 p-4 shadow-[0_24px_70px_rgba(0,0,0,.45)] sm:p-6">
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#ffd76a] to-transparent" />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[.2em] text-[#f5bd31]">New player reward</p>
          <h2 className="mt-1 text-xl font-black text-white">Create your account</h2>
        </div>
        <div className="rounded-xl border border-[#f5bd31]/20 bg-[#f5bd31]/10 px-3 py-2 text-right">
          <p className="text-[9px] font-bold uppercase text-white/45">Claim up to</p>
          <p className="text-lg font-black leading-none text-[#ffd76a]">{money(bonus)}</p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex h-14 items-center rounded-2xl border border-white/10 bg-[#090c14] focus-within:border-[#f5bd31]/70">
          <span className="flex h-full items-center gap-2 border-r border-white/10 px-4 text-sm font-black text-white">
            <span aria-hidden>🇮🇳</span> +91
          </span>
          <Phone size={17} className="ml-3 shrink-0 text-white/35" />
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            maxLength={10}
            placeholder="10-digit mobile number"
            className="min-w-0 flex-1 bg-transparent px-3 text-sm font-bold text-white outline-none placeholder:text-white/28"
            onFocus={() => setCaptchaArmed(true)}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
          />
        </label>

        <label className="flex h-14 items-center rounded-2xl border border-white/10 bg-[#090c14] focus-within:border-[#f5bd31]/70">
          <LockKeyhole size={17} className="ml-4 shrink-0 text-white/35" />
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            placeholder="Create a password (8+ characters)"
            className="min-w-0 flex-1 bg-transparent px-3 text-sm font-bold text-white outline-none placeholder:text-white/28"
            onFocus={() => setCaptchaArmed(true)}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onSubmit() }}
          />
          <button type="button" className="px-4 text-white/40" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </label>

        {TURNSTILE_SITE_KEY && captchaArmed && (
          <div className="rounded-2xl bg-[#090c14] py-1">
            <div ref={captchaRef} className="flex min-h-[65px] items-center justify-center" />
            {captchaError && <p className="pb-2 text-center text-xs font-bold text-amber-300">Security check failed. Please refresh and try again.</p>}
          </div>
        )}

        {error && <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200">{error}</p>}

        <button
          type="button"
          disabled={loading}
          onClick={() => void onSubmit()}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#ffe070] via-[#f7c332] to-[#e9a914] text-sm font-black text-[#281800] shadow-[0_10px_30px_rgba(237,177,31,.28)] transition active:scale-[.98] disabled:opacity-60"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Gift size={18} />}
          Register & Claim {money(bonus)}
        </button>
      </div>

      <p className="mt-3 text-center text-[10px] leading-relaxed text-white/35">By continuing, you confirm that you are 18+ and agree to the Terms &amp; Conditions.</p>
      <button type="button" className="mt-2 w-full text-center text-xs font-bold text-white/55" onClick={() => void useAuthStore.getState().ensureLoggedIn('Log in to continue')}>
        Already registered? <span className="text-[#ffd76a]">Log in</span>
      </button>
    </div>
  )
}

export default function IndiaLandingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const auth = useAuthStore()
  const promo = usePromotionStore()
  const setActiveCurrency = useWalletStore((s) => s.setActiveCurrency)
  const [summary, setSummary] = useState<NewPlayerSummary | null>(null)
  const [games, setGames] = useState<SlotGame[]>([])
  const [claimedNow, setClaimedNow] = useState(false)
  const [trialDeviceBlocked, setTrialDeviceBlocked] = useState(() => sessionStorage.getItem(TRIAL_DEVICE_BLOCKED_KEY) === '1')
  const [claimError, setClaimError] = useState<string | null>(null)

  useEffect(() => {
    setActiveCurrency('INR')
    void promo.loadPromoConfig()
    void fetchHomepageGames('INR')
      .then((data) => setGames([...data.popular, ...data.recommended].filter((game, index, all) => game.imageUrl && all.findIndex((item) => item.uuid === game.uuid) === index).slice(0, 6)))
      .catch(() => setGames([]))
  }, [])

  useEffect(() => {
    void fetchNewPlayerSummary('INR').then(setSummary).catch(() => setSummary(null))
  }, [auth.token, claimedNow])

  const trialAmount = promo.promoConfig?.trial.amountByCcy?.INR ?? summary?.tasks.trial.amount ?? 130
  const tiers = promo.promoConfig?.firstdep.tiers?.INR ?? []
  const firstTier = tiers.find((tier) => tier.bonusAmount > 0) ?? null
  const maxFirstDepositBonus = Math.max(0, ...tiers.map((tier) => tier.bonusAmount))
  const loggedIn = Boolean(auth.token && auth.user)
  const trialClaimed = claimedNow || Boolean(summary?.tasks.trial.claimed)
  const firstDepositDone = Boolean(summary?.tasks.firstdep.done)
  const appDownloadEnabled = isFeatureEnabled('app_download')
  const appDownloadReward = promo.promoConfig?.appdl.amountByCcy?.INR ?? summary?.tasks.appdl.amount ?? 0
  const trialFinished = trialClaimed || trialDeviceBlocked
  const currentStep = !loggedIn ? 1 : !trialFinished ? 2 : 3

  const topOffer = useMemo(() => {
    if (!loggedIn) return { eyebrow: 'India welcome offer', title: `Unlock ${money(trialAmount)} free`, button: `Register & claim ${money(trialAmount)}` }
    if (trialDeviceBlocked) return { eyebrow: 'Account ready', title: 'Welcome reward already used on this device', button: 'Explore games' }
    if (!trialClaimed) return { eyebrow: 'One tap away', title: `Your ${money(trialAmount)} reward is ready`, button: `Claim ${money(trialAmount)}` }
    if (firstDepositDone) return { eyebrow: 'Account ready', title: 'Your next win is waiting', button: 'Explore games' }
    return { eyebrow: 'Bonus claimed', title: `${money(trialAmount)} added to your rewards`, button: 'Play now' }
  }, [firstDepositDone, loggedIn, trialAmount, trialClaimed, trialDeviceBlocked])

  async function primaryAction() {
    setClaimError(null)
    if (!loggedIn) {
      analytics.landingAction('primary_cta', 'guest')
      document.getElementById('landing-register')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (trialDeviceBlocked) {
      analytics.landingAction('primary_cta', 'device_already_claimed')
      navigate('/games')
      return
    }
    if (!trialClaimed) {
      analytics.landingAction('primary_cta', 'claim_reward')
      const result = await promo.claimTrialIfEligible({ silent: true })
      if (result.ok || result.alreadyClaimed) {
        setClaimedNow(true)
        return
      }
      if (result.message === 'errors.deviceAlreadyClaimed') {
        sessionStorage.setItem(TRIAL_DEVICE_BLOCKED_KEY, '1')
        setTrialDeviceBlocked(true)
        setClaimError(translateApiError(result.message, t))
        return
      }
      setClaimError(result.message ? translateApiError(result.message, t) : 'Unable to claim your reward. Please try again.')
      return
    }
    analytics.landingAction('primary_cta', 'play')
    navigate('/games')
  }

  function openDeposit() {
    analytics.landingAction('deposit_cta', 'registered')
    navigate('/home?wallet=deposit')
  }

  return (
    <div className="min-h-dvh bg-[#07090f] text-white selection:bg-[#f5bd31]/30">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-28 top-16 h-72 w-72 rounded-full bg-[#7c2d12]/20 blur-[90px]" />
        <div className="absolute -right-32 top-[28rem] h-80 w-80 rounded-full bg-[#d79516]/10 blur-[100px]" />
      </div>

      <header className="relative z-10 border-b border-white/[.06] bg-[#080a10]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <SiteLogo />
          <div className="flex items-center gap-2 text-[11px] font-bold text-white/55">
            <ShieldCheck size={16} className="text-[#f5bd31]" /> Secure access
          </div>
        </div>
      </header>

      <main className="relative z-[1]">
        <section className={`mx-auto grid max-w-6xl gap-4 px-4 py-4 sm:px-6 sm:py-7 ${loggedIn ? '' : 'lg:grid-cols-[1.08fr_.92fr] lg:items-center'}`}>
          <div className="relative overflow-hidden rounded-[24px] border border-white/[.07] bg-[radial-gradient(circle_at_76%_30%,rgba(245,189,49,.19),transparent_34%),linear-gradient(145deg,#171018,#0a0d16_64%)] px-5 py-5 sm:px-8 sm:py-8">
            <div className="relative z-10 max-w-[570px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f5bd31]/25 bg-[#f5bd31]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[.18em] text-[#ffd76a]">
                <Sparkles size={13} /> {topOffer.eyebrow}
              </div>
              <h1 className="mt-4 max-w-lg font-display text-[36px] font-black uppercase leading-[.94] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Play more.<br /><span className="text-transparent [-webkit-text-stroke:1px_#ffd76a]">Win more.</span>
              </h1>
              <p className="mt-3 text-lg font-black text-white sm:text-xl">{topOffer.title}</p>
              {!loggedIn && <p className="mt-1.5 max-w-md text-xs leading-relaxed text-white/55 sm:text-sm">Create your account in seconds. No deposit is needed to claim the welcome reward.</p>}

              {loggedIn && (
                <button type="button" onClick={() => void primaryAction()} className="mt-5 flex h-13 w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#ffe070] to-[#eaaa17] px-5 text-sm font-black text-[#281800] shadow-[0_12px_36px_rgba(234,170,23,.27)] transition active:scale-[.98]">
                  {promo.trialClaiming ? <Loader2 size={18} className="animate-spin" /> : <Gift size={18} />}
                  {topOffer.button}<ChevronRight size={18} />
                </button>
              )}
              {claimError && <p className={`mt-2 max-w-sm text-xs font-semibold ${trialDeviceBlocked ? 'text-amber-300' : 'text-red-300'}`}>{claimError}</p>}
            </div>

            <div className="relative z-10 mt-5 flex items-center gap-2 sm:max-w-md">
              {[['1', 'Register'], ['2', 'Claim reward'], ['3', 'Start playing']].map(([step, label], index) => {
                const done = currentStep > Number(step)
                const active = currentStep === Number(step)
                return (
                  <div key={step} className="flex min-w-0 flex-1 items-center gap-2">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${done ? 'bg-[#2fb968] text-white' : active ? 'bg-[#f5bd31] text-black' : 'border border-white/15 bg-white/[.04] text-white/35'}`}>
                      {done ? <Check size={14} strokeWidth={3} /> : step}
                    </span>
                    <span className={`text-[9px] font-bold leading-tight sm:text-[11px] ${active || done ? 'text-white/80' : 'text-white/30'}`}>{label}</span>
                    {index < 2 && <span className="ml-auto h-px w-3 bg-white/10 sm:w-7" />}
                  </div>
                )
              })}
            </div>

            <img src={coinsGift} alt="" className="pointer-events-none absolute -right-14 top-9 w-48 opacity-20 blur-[1px] sm:right-0 sm:top-10 sm:w-64 sm:opacity-45" />
            <div className="pointer-events-none absolute bottom-0 right-0 h-44 w-44 bg-[radial-gradient(circle,#f5bd3130,transparent_68%)]" />
          </div>

          {!loggedIn && <LandingRegisterForm bonus={trialAmount} />}
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
          {!firstDepositDone && maxFirstDepositBonus > 0 && (
            <div className="rounded-2xl border border-[#f5bd31]/15 bg-gradient-to-r from-[#23150a] via-[#171016] to-[#10131c] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[.2em] text-[#f5bd31]">First deposit boost</p>
                <h2 className="mt-1 text-lg font-black sm:text-xl">Get up to {money(maxFirstDepositBonus)} extra on your first deposit.</h2>
                {firstTier && <p className="mt-1 text-xs text-white/50">Start with {money(firstTier.depositAmount)} → receive {money(firstTier.bonusAmount)} bonus.</p>}
              </div>
              {loggedIn && (
                <button type="button" onClick={openDeposit} className="mt-3 inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-xs font-black text-[#13151c] sm:mt-0">
                  <WalletCards size={16} /> Deposit now
                </button>
              )}
            </div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              [ShieldCheck, 'Secure account', 'Protected access'],
              [IndianRupee, 'INR payments', 'Made for India'],
              [Headphones, '24/7 support', 'Help anytime'],
            ].map(([Icon, title, sub]) => (
              <div key={String(title)} className="rounded-xl border border-white/[.07] bg-white/[.035] px-1.5 py-2.5 text-center sm:px-3">
                <Icon size={18} className="mx-auto text-[#f5bd31]" />
                <p className="mt-1.5 text-[10px] font-black sm:text-xs">{String(title)}</p>
                <p className="mt-0.5 hidden text-[9px] text-white/35 sm:block">{String(sub)}</p>
              </div>
            ))}
          </div>
        </section>

        {games.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[.2em] text-[#f5bd31]">Fan favourites</p>
                <h2 className="mt-0.5 text-lg font-black">Popular games</h2>
              </div>
              <button type="button" onClick={() => loggedIn ? navigate('/games') : document.getElementById('landing-register')?.scrollIntoView({ behavior: 'smooth' })} className="text-xs font-black text-[#ffd76a]">View all</button>
            </div>
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 hide-scrollbar sm:grid sm:grid-cols-6 sm:gap-3">
              {games.map((game) => (
                <button key={game.uuid} type="button" onClick={() => loggedIn ? navigate('/games') : document.getElementById('landing-register')?.scrollIntoView({ behavior: 'smooth' })} className="group w-[72px] shrink-0 text-left sm:w-auto">
                  <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-[#141824]">
                    <img src={game.imageHqUrl ?? game.imageUrl ?? ''} alt={game.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                  </div>
                  <p className="mt-1.5 truncate text-[10px] font-bold text-white/70">{game.name}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {appDownloadEnabled && (
          <section className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.035] p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f5bd31]/10 text-[#f5bd31]"><Download size={20} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black">Get the Betogo app</p>
                <p className="truncate text-[10px] text-white/40">Faster access{appDownloadReward > 0 ? ` · ${money(appDownloadReward)} install bonus` : ' · Full-screen play'}</p>
              </div>
              <button type="button" onClick={() => { analytics.landingAction('download_cta', loggedIn ? 'registered' : 'guest'); navigate('/download') }} className="shrink-0 rounded-lg border border-[#f5bd31]/25 px-3 py-2 text-xs font-black text-[#ffd76a]">Install</button>
            </div>
          </section>
        )}

        <footer className="mx-auto max-w-6xl px-6 pb-5 pt-3 text-center text-[9px] leading-relaxed text-white/25">
          18+ only. Please play responsibly. Bonus eligibility and wagering requirements apply.<br />© {new Date().getFullYear()} Betogo. All rights reserved.
        </footer>
      </main>
    </div>
  )
}
