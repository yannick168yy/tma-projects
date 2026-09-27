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

function useCountUp(target: number) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let frame = 0
    const began = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / 900)
      setValue(Math.round(target * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return value
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
  const [submitPending, setSubmitPending] = useState(false)
  const captchaRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<string | null>(null)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !captchaArmed || widgetRef.current) return
    let cancelled = false
    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !captchaRef.current || widgetRef.current) return
        // 无感模式：只有 Cloudflare 判定需要人工点选时才显示控件，平时只占一行状态文字
        widgetRef.current = turnstile.render(captchaRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          retry: 'auto',
          appearance: 'interaction-only',
          callback: (token) => { setCaptchaToken(token); setCaptchaError(false) },
          'expired-callback': () => setCaptchaToken(undefined),
          'error-callback': () => { setCaptchaToken(undefined); setCaptchaError(true); setSubmitPending(false) },
        })
      })
      .catch(() => { if (!cancelled) { setCaptchaError(true); setSubmitPending(false) } })
    return () => { cancelled = true }
  }, [captchaArmed])

  // 用户在验证完成前点了提交：拿到 token 后自动续提交，不让用户再点一次
  useEffect(() => {
    if (!submitPending || !captchaToken) return
    setSubmitPending(false)
    void onSubmit()
  }, [submitPending, captchaToken])

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
    setError(null)
    if (TURNSTILE_SITE_KEY && !captchaToken && !captchaError) {
      setCaptchaArmed(true)
      setSubmitPending(true)
      return
    }
    setLoading(true)
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

  const busy = loading || submitPending

  return (
    <div id="landing-register" className="space-y-2.5">
      <label className="flex h-12 items-center rounded-xl border border-white/10 bg-[#090c14] focus-within:border-[#f5bd31]/70">
        <span className="flex h-full items-center gap-1.5 border-r border-white/10 px-3 text-sm font-black text-white">
          <span aria-hidden>🇮🇳</span> +91
        </span>
        <Phone size={16} className="ml-3 shrink-0 text-white/35" />
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

      <label className="flex h-12 items-center rounded-xl border border-white/10 bg-[#090c14] focus-within:border-[#f5bd31]/70">
        <LockKeyhole size={16} className="ml-3.5 shrink-0 text-white/35" />
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
        <button type="button" className="px-3.5 text-white/40" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
          {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </label>

      {TURNSTILE_SITE_KEY && captchaArmed && <div ref={captchaRef} className="flex justify-center empty:hidden" />}

      {error && <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => void onSubmit()}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#ffe070] via-[#f7c332] to-[#e9a914] text-[15px] font-black text-[#281800] shadow-[0_10px_30px_rgba(237,177,31,.28)] transition active:scale-[.98] disabled:opacity-70"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Gift size={18} />}
        {submitPending ? 'Verifying…' : `Register & Claim ${money(bonus)} Free`}
      </button>

      <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] text-white/35">
        {TURNSTILE_SITE_KEY ? (
          <span className={`flex items-center gap-1 ${captchaError ? 'text-amber-300' : captchaToken ? 'text-[#4ade80]/80' : ''}`}>
            <ShieldCheck size={12} />
            {captchaError ? 'Security check failed, refresh' : captchaToken ? 'Verified' : 'Protected by Cloudflare'}
          </span>
        ) : <span />}
        <button type="button" className="text-xs font-bold text-white/55" onClick={() => void useAuthStore.getState().ensureLoggedIn('Log in to continue')}>
          Have an account? <span className="text-[#ffd76a]">Log in</span>
        </button>
      </div>
      <p className="text-center text-[9px] leading-snug text-white/28">By registering, you confirm you are 18+ and accept the Terms &amp; Conditions.</p>
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
  const trialEnabled = promo.promoConfig?.trial.enabled ?? summary?.tasks.trial.enabled ?? true
  const appdlEnabled = appDownloadEnabled && (promo.promoConfig?.appdl.enabled ?? summary?.tasks.appdl.enabled ?? false) && appDownloadReward > 0
  const firstdepEnabled = (promo.promoConfig?.firstdep.enabled ?? summary?.tasks.firstdep.enabled ?? true) && maxFirstDepositBonus > 0
  const cashbackMonthlyCap = summary?.cashback.monthlyCap ?? 0
  const cashbackRate = summary?.cashback.topRatePct ?? 0
  // 大数字 = 下方四格之和，每一块都能在站内领到，口径与 /promotions/new-player-summary 的 totalShowcase 一致
  const instantTotal = (trialEnabled ? trialAmount : 0) + (appdlEnabled ? appDownloadReward : 0)
  const packageTotal = instantTotal + (firstdepEnabled ? maxFirstDepositBonus : 0) + cashbackMonthlyCap
  const shownTotal = useCountUp(packageTotal)
  const packageItems = [
    trialEnabled && {
      key: 'trial', icon: Gift, label: 'Sign-up bonus', amount: money(trialAmount),
      note: trialDeviceBlocked ? 'Used on this device' : 'Instant · no deposit', done: trialClaimed,
    },
    appdlEnabled && {
      key: 'appdl', icon: Download, label: 'App install', amount: money(appDownloadReward),
      note: 'Instant after install', done: Boolean(summary?.tasks.appdl.claimed),
    },
    firstdepEnabled && {
      key: 'firstdep', icon: WalletCards, label: '1st deposit bonus', amount: `Up to ${money(maxFirstDepositBonus)}`,
      note: firstTier ? `From ${money(firstTier.depositAmount)} deposit` : 'On your first top-up', done: firstDepositDone,
    },
    {
      key: 'cashback', icon: IndianRupee, label: 'Cashback', amount: cashbackMonthlyCap > 0 ? `${money(cashbackMonthlyCap)}/mo` : 'Unlimited',
      note: cashbackRate > 0 ? `Up to ${cashbackRate}% back daily` : 'Paid daily', done: false,
    },
  ].filter((item) => item !== false)

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
        <section className="mx-auto max-w-6xl px-4 py-3 sm:px-6 sm:py-6">
          <div className="relative overflow-hidden rounded-[24px] border border-[#f7c94b]/20 bg-[radial-gradient(circle_at_85%_8%,rgba(245,189,49,.22),transparent_38%),linear-gradient(160deg,#1a1119,#0b0e17_58%)] p-4 shadow-[0_24px_70px_rgba(0,0,0,.45)] sm:p-7 lg:grid lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:gap-8">
            <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#ffd76a] to-transparent" />
            <img src={coinsGift} alt="" className="pointer-events-none absolute -right-8 -top-2 w-36 opacity-35 sm:w-52 sm:opacity-50" />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-[#f5bd31]/25 bg-[#f5bd31]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[.16em] text-[#ffd76a]">
                <Sparkles size={12} /> {topOffer.eyebrow}
              </div>
              <p className="mt-3 text-[11px] font-black uppercase tracking-[.18em] text-white/60">New player package</p>
              <h1 className="font-display text-[46px] font-black leading-[1.02] tracking-tight bg-gradient-to-b from-[#fff6c9] via-[#ffd76a] to-[#e9a914] bg-clip-text text-transparent sm:text-6xl">
                {money(shownTotal)}
              </h1>
              <p className="mt-1 text-xs font-semibold text-white/65 sm:text-sm">
                {instantTotal > 0
                  ? <>Includes <span className="font-black text-[#ffd76a]">{money(instantTotal)} free instantly</span> — no deposit needed.</>
                  : 'Start your welcome journey today.'}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {packageItems.map(({ key, icon: Icon, label, amount, note, done }) => (
                  <div key={key} className={`relative rounded-xl border px-2.5 py-2 ${done ? 'border-[#2fb968]/30 bg-[#2fb968]/[.07]' : 'border-white/[.08] bg-white/[.04]'}`}>
                    <p className="flex items-center gap-1 text-[10px] font-bold text-white/55">
                      <Icon size={12} className="shrink-0 text-[#f5bd31]" />{label}
                    </p>
                    <p className="mt-0.5 truncate text-[15px] font-black leading-tight text-white">{amount}</p>
                    <p className={`truncate text-[9px] font-semibold ${done ? 'text-[#4ade80]' : 'text-white/38'}`}>{done ? 'Claimed' : note}</p>
                    {done && <Check size={13} strokeWidth={3} className="absolute right-2 top-2 text-[#4ade80]" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="relative z-10 mt-4 lg:mt-0">
              {loggedIn ? (
                <div className="rounded-2xl border border-white/[.07] bg-black/20 p-3.5">
                  <p className="text-base font-black text-white">{topOffer.title}</p>
                  <button type="button" onClick={() => void primaryAction()} className="mt-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#ffe070] to-[#eaaa17] px-5 text-sm font-black text-[#281800] shadow-[0_12px_36px_rgba(234,170,23,.27)] transition active:scale-[.98]">
                    {promo.trialClaiming ? <Loader2 size={18} className="animate-spin" /> : <Gift size={18} />}
                    {topOffer.button}<ChevronRight size={18} />
                  </button>
                  {claimError && <p className={`mt-2 text-xs font-semibold ${trialDeviceBlocked ? 'text-amber-300' : 'text-red-300'}`}>{claimError}</p>}
                </div>
              ) : (
                <LandingRegisterForm bonus={trialAmount} />
              )}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
          {loggedIn && !firstDepositDone && maxFirstDepositBonus > 0 && (
            <div className="rounded-2xl border border-[#f5bd31]/15 bg-gradient-to-r from-[#23150a] via-[#171016] to-[#10131c] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[.2em] text-[#f5bd31]">First deposit boost</p>
                <h2 className="mt-1 text-lg font-black sm:text-xl">Get up to {money(maxFirstDepositBonus)} extra on your first deposit.</h2>
                {firstTier && <p className="mt-1 text-xs text-white/50">Start with {money(firstTier.depositAmount)} → receive {money(firstTier.bonusAmount)} bonus.</p>}
              </div>
              <button type="button" onClick={openDeposit} className="mt-3 inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-xs font-black text-[#13151c] sm:mt-0">
                <WalletCards size={16} /> Deposit now
              </button>
            </div>
          )}

          <div className={`${loggedIn ? 'mt-3 ' : ''}grid grid-cols-3 gap-2 sm:gap-3`}>
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
