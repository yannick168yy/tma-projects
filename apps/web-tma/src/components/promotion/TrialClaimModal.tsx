import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X, Check, Gift, Loader2, ShieldCheck } from 'lucide-react'
import { ApiError } from '@/api/client'
import { bindKycPhone, fetchKycStatus, sendKycOtp, verifyKycOtp } from '@/api/kyc'
import { usePromotionStore } from '@/stores/promotion'

interface Props {
  open: boolean
  amountPhp: number
  onClose: () => void
}

type Translate = (key: string, opts?: Record<string, unknown>) => string

function translateSmsError(message: string, t: Translate): string {
  if (message.startsWith('kyc.errors.smsFailedWithCode:')) {
    const code = message.slice('kyc.errors.smsFailedWithCode:'.length)
    return t('kyc.errors.smsFailedWithCode', { code })
  }
  if (message.startsWith('kyc.')) return t(message)
  return message
}

type Step = 'loading' | 'phone' | 'claim'

/** 首席体验官：领取免费礼金前先引导绑定手机号（短信验证，逻辑复用 KYC 第一步）。 */
export default function TrialClaimModal({ open, amountPhp, onClose }: Props) {
  const { t } = useTranslation()
  const claimTrialIfEligible = usePromotionStore((s) => s.claimTrialIfEligible)
  const trialClaiming = usePromotionStore((s) => s.trialClaiming)

  const [step, setStep] = useState<Step>('loading')
  // 后台「手机验证」开关：开=绑定需短信 OTP；关=直接绑定。两种情况都必须绑定手机号
  const [otpRequired, setOtpRequired] = useState(true)
  const [phone, setPhone] = useState('')
  const [phoneLocked, setPhoneLocked] = useState(false)
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    setStep('loading')
    setCode('')
    setError(null)
    setResendIn(0)
    void fetchKycStatus()
      .then((s) => {
        if (s.phoneVerified) {
          setStep('claim')
          return
        }
        setOtpRequired(s.requirePhone)
        if (s.registeredPhone) {
          setPhone(s.registeredPhone)
          setPhoneLocked(true)
        } else if (s.phone) {
          setPhone(s.phone)
          setPhoneLocked(false)
        }
        setStep('phone')
      })
      .catch(() => setStep('phone'))
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setInterval(() => setResendIn((v) => v - 1), 1000)
    return () => clearInterval(id)
  }, [resendIn])

  async function onSendCode() {
    if (!phone.trim()) { setError(t('kyc.fillAll')); return }
    setLoading(true); setError(null)
    try {
      const res = await sendKycOtp(phone.trim())
      setResendIn(res.resendInSec || 60)
    } catch (e) {
      setError(e instanceof ApiError ? translateSmsError(e.message, t) : t('auth.loginFailed'))
    } finally { setLoading(false) }
  }

  async function onVerifyCode() {
    if (!code.trim()) { setError(t('kyc.fillAll')); return }
    setLoading(true); setError(null)
    try {
      await verifyKycOtp(code.trim())
      setStep('claim')
    } catch (e) {
      setError(e instanceof ApiError ? translateSmsError(e.message, t) : t('kyc.rejected'))
    } finally { setLoading(false) }
  }

  async function onBindDirect() {
    if (!phone.trim()) { setError(t('kyc.fillAll')); return }
    setLoading(true); setError(null)
    try {
      await bindKycPhone(phone.trim())
      setStep('claim')
    } catch (e) {
      setError(e instanceof ApiError ? translateSmsError(e.message, t) : t('auth.loginFailed'))
    } finally { setLoading(false) }
  }

  async function onClaim() {
    setError(null)
    const result = await claimTrialIfEligible()
    if (result.ok || result.alreadyClaimed) {
      onClose()
      return
    }
    if (result.message) setError(result.message)
  }

  if (!open) return null

  const inputCls = 'w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground focus:border-primary focus:outline-none'

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 max-h-[92vh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl border border-border bg-card p-6 shadow-2xl sm:rounded-3xl">
        <button type="button" className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X size={18} />
        </button>

        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck size={20} className="text-primary" />
          <h2 className="text-lg font-black text-foreground">{t('bonuses.promos.trial.bind.title')}</h2>
        </div>
        <p className="mb-5 text-xs text-muted-foreground">{t(otpRequired ? 'bonuses.promos.trial.bind.subtitle' : 'bonuses.promos.trial.bind.subtitleNoOtp', { amount: amountPhp })}</p>

        {step === 'loading' && (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        )}

        {step === 'phone' && (
          <div className="space-y-3">
            {otpRequired ? (
              <>
                <div className="flex gap-2">
                  <input value={phone} type="tel" placeholder={t('auth.phonePlaceholder')} className={`flex-1 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground focus:border-primary focus:outline-none${phoneLocked ? ' opacity-60' : ''}`} readOnly={phoneLocked} onChange={(e) => setPhone(e.target.value)} />
                  <button type="button" className="shrink-0 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground disabled:opacity-50" disabled={loading || resendIn > 0} onClick={() => void onSendCode()}>
                    {resendIn > 0 ? t('kyc.resendIn', { s: resendIn }) : t('kyc.sendCode')}
                  </button>
                </div>
                {phoneLocked && <p className="text-[10px] text-muted-foreground">{t('kyc.phoneLocked')}</p>}
                <input value={code} type="text" inputMode="numeric" maxLength={6} placeholder={t('kyc.codeLabel')} className={inputCls} onChange={(e) => setCode(e.target.value)} />
                <button type="button" className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50" disabled={loading} onClick={() => void onVerifyCode()}>
                  {loading ? <Loader2 size={16} className="mx-auto animate-spin" /> : t('kyc.verify')}
                </button>
              </>
            ) : (
              <>
                <input value={phone} type="tel" placeholder={t('auth.phonePlaceholder')} className={`${inputCls}${phoneLocked ? ' opacity-60' : ''}`} readOnly={phoneLocked} onChange={(e) => setPhone(e.target.value)} />
                {phoneLocked && <p className="text-[10px] text-muted-foreground">{t('kyc.phoneLocked')}</p>}
                <button type="button" className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50" disabled={loading} onClick={() => void onBindDirect()}>
                  {loading ? <Loader2 size={16} className="mx-auto animate-spin" /> : t('kyc.bindPhoneCta')}
                </button>
              </>
            )}
          </div>
        )}

        {step === 'claim' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3">
              <Check size={18} className="shrink-0 text-emerald-400" />
              <p className="text-xs font-bold text-emerald-400">{t('bonuses.promos.trial.bind.bound')}</p>
            </div>
            <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground disabled:opacity-50" disabled={trialClaiming} onClick={() => void onClaim()}>
              {trialClaiming ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />}
              {trialClaiming ? t('bonuses.promos.trial.claiming') : t('bonuses.promos.trial.bind.claimCta', { amount: amountPhp })}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>,
    document.body,
  )
}
