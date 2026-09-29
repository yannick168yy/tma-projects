import '@/styles/india-welcome-static.css'
import { apiRequest, ApiError } from '@/api/client'
import type { NewPlayerSummary, PromoConfig } from '@/api/promotion'
import { captureAttributionFromUrl } from '@/utils/attribution'
import { captureReferralFromUrl, getStoredReferral } from '@/utils/referral'
import { initAnalytics, analytics, trackPageView } from '@/utils/analytics'
import { initPixels } from '@/utils/pixels'
import { initRevosurgeTracker } from '@/utils/revosurgeTracker'
import { initFingerprint } from '@/utils/fingerprint'
import { reportPagePerf } from '@/utils/clientErrorReport'
import { getToken, setToken } from '@/utils/tokenStore'
import type { AuthSession } from '@/types/api'

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || ''
const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const money = (amount: number) => `₹${INR.format(amount)}`

const form = document.querySelector<HTMLFormElement>('#welcome-auth-form')!
const phoneInput = document.querySelector<HTMLInputElement>('#phone')!
const passwordInput = document.querySelector<HTMLInputElement>('#password')!
const passwordToggle = document.querySelector<HTMLButtonElement>('#password-toggle')!
const submitButton = document.querySelector<HTMLButtonElement>('#submit-button')!
const submitLabel = submitButton.querySelector<HTMLSpanElement>('span')!
const errorEl = document.querySelector<HTMLElement>('#form-error')!
const successEl = document.querySelector<HTMLElement>('#form-success')!
const turnstileSlot = document.querySelector<HTMLElement>('#turnstile-slot')!
const securityLabel = document.querySelector<HTMLElement>('#security-label')!

let trialAmount = 28
let captchaToken = ''
let captchaLoading = false
let widgetId = ''

captureReferralFromUrl()
captureAttributionFromUrl()
// 已登录用户不再看注册表单；领奖/充值引导由主站（TrialWelcomeSheet 等）接手
if (getToken()) location.replace('/home')
initAnalytics()
initPixels()
initRevosurgeTracker()
trackPageView(`${location.pathname}${location.search}`, document.title)
requestAnimationFrame(() => requestAnimationFrame(() => reportPagePerf('perf-welcome-static')))
void loadOffer()

function registerLabel() {
  return `Register & Claim ${money(trialAmount)} Free`
}

function setBenefit(id: string, enabled: boolean, amount: string, note: string) {
  const card = document.querySelector<HTMLElement>(`#benefit-${id}`)!
  card.hidden = !enabled
  card.querySelector('strong')!.textContent = amount
  card.querySelector('small')!.textContent = note
}

// HTML 里是当前生产的默认值，保证首屏秒开；配置拉到后按后台实际活动覆盖，口径与 React 版 IndiaLandingPage 一致
async function loadOffer() {
  const [summary, config] = await Promise.all([
    apiRequest<NewPlayerSummary>('/promotions/new-player-summary?currency=INR'),
    apiRequest<PromoConfig>('/promotions/config').catch(() => null),
  ]).catch(() => [null, null] as const)
  if (!summary) return
  const { trial, appdl, firstdep } = summary.tasks
  const firstTier = config?.firstdep.tiers?.INR?.find((tier) => tier.bonusAmount > 0)
  const firstdepEnabled = firstdep.enabled && firstdep.maxBonus > 0
  const appdlEnabled = appdl.enabled && appdl.amount > 0
  const instantTotal = (trial.enabled ? trial.amount : 0) + (appdlEnabled ? appdl.amount : 0)
  const { monthlyCap, topRatePct } = summary.cashback

  trialAmount = trial.amount
  if (!submitButton.disabled) submitLabel.textContent = registerLabel()
  document.querySelector('#package-total')!.textContent = money(summary.totalShowcase)
  document.querySelector('#offer-note strong')!.textContent = `${money(instantTotal)} free instantly`
  setBenefit('trial', trial.enabled, money(trial.amount), 'Instant · no deposit')
  setBenefit('appdl', appdlEnabled, money(appdl.amount), 'Instant after install')
  setBenefit('firstdep', firstdepEnabled, `Up to ${money(firstdep.maxBonus)}`,
    firstTier ? `From ${money(firstTier.depositAmount)} deposit` : 'On your first top-up')
  setBenefit('cashback', true, monthlyCap > 0 ? `${money(monthlyCap)}/mo` : 'Unlimited',
    topRatePct > 0 ? `Up to ${topRatePct}% back daily` : 'Paid daily')
}

function showError(message: string) {
  successEl.hidden = true
  errorEl.textContent = message
  errorEl.hidden = false
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === 'errors.captchaFailed') return 'Security verification failed. Please try again.'
  if (/already|exist/i.test(message)) return 'This mobile number already has an account. Tap Log in below.'
  if (error instanceof ApiError && error.network) return 'Network connection failed. Please try again.'
  return message && !message.startsWith('errors.') ? message : 'Unable to continue. Please try again.'
}

async function armCaptcha() {
  if (!TURNSTILE_SITE_KEY || widgetId || captchaLoading) return
  captchaLoading = true
  securityLabel.textContent = 'Loading security check…'
  try {
    const { loadTurnstile } = await import('@/utils/turnstile')
    const turnstile = await loadTurnstile()
    widgetId = turnstile.render(turnstileSlot, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'dark',
      retry: 'auto',
      appearance: 'interaction-only',
      callback: (token) => {
        captchaToken = token
        securityLabel.textContent = 'Security check complete'
      },
      'expired-callback': () => {
        captchaToken = ''
        securityLabel.textContent = 'Security check expired'
      },
      'error-callback': () => {
        captchaToken = ''
        securityLabel.textContent = 'Security check failed'
      },
    })
  } catch {
    securityLabel.textContent = 'Security check unavailable'
  } finally {
    captchaLoading = false
  }
}

// 设备指纹进注册请求头，注册金「一台设备只领一次」靠它判定；用户开始填表时再算，不拖首屏
function armProtection() {
  void initFingerprint()
  void armCaptcha()
}

phoneInput.addEventListener('input', () => {
  phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 10)
})
phoneInput.addEventListener('focus', armProtection, { once: true })
passwordInput.addEventListener('focus', armProtection, { once: true })

passwordToggle.addEventListener('click', () => {
  const show = passwordInput.type === 'password'
  passwordInput.type = show ? 'text' : 'password'
  passwordToggle.textContent = show ? 'Hide' : 'Show'
  passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  errorEl.hidden = true
  successEl.hidden = true
  const digits = phoneInput.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
  const password = passwordInput.value
  if (digits.length !== 10) return showError("Please enter a valid 10-digit mobile number — you'll need it to verify withdrawals.")
  if (password.length < 8) return showError('Password must be at least 8 characters.')

  if (TURNSTILE_SITE_KEY && !captchaToken) {
    await armCaptcha()
    return showError('Complete the security check, then tap Register again.')
  }

  submitButton.disabled = true
  submitLabel.textContent = 'Creating account…'
  analytics.landingAction('register_submit', 'guest')
  analytics.loginStart('phone')
  try {
    await initFingerprint()
    const session = await apiRequest<AuthSession>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ method: 'phone', identifier: `+91${digits}`, password, referralCode: getStoredReferral() ?? undefined, turnstileToken: captchaToken || undefined }),
    })
    setToken(session.token)
    analytics.loginSuccess(session.user.loginProvider ?? 'phone', session.isNewUser, session.user.id)
    successEl.textContent = 'Account created. Opening your rewards…'
    successEl.hidden = false
    window.location.assign('/home')
  } catch (error) {
    showError(friendlyError(error))
    captchaToken = ''
    if (widgetId) window.turnstile?.reset(widgetId)
  } finally {
    submitButton.disabled = false
    submitLabel.textContent = registerLabel()
  }
})
