import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { X, Check, Loader2, ShieldCheck, Upload } from 'lucide-react'
import { ApiError } from '@/api/client'
import {
  fetchKycStatus,
  sendKycOtp,
  submitKycDocument,
  submitKycFace,
  verifyKycOtp,
} from '@/api/kyc'
import type { LivenessAction } from '@/api/kyc'
import FaceLivenessCapture from '@/components/wallet/FaceLivenessCapture'

interface Props {
  open: boolean
  onClose: () => void
  onApproved?: () => void
}

function compressImage(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('canvas unavailable')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
      URL.revokeObjectURL(img.src)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

const DOC_TYPES = ['passport', 'drivers_license', 'philid', 'umid'] as const
type Step = 'phone' | 'document' | 'face' | 'done'

function translateRejectReason(reason: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  return reason
    .split(';')
    .map((code) => t(`kyc.reasons.${code.trim()}`, { defaultValue: code.trim() }))
    .join(' · ')
}

function resolveStep(s: Awaited<ReturnType<typeof fetchKycStatus>>): Step {
  if (s.status === 'approved') return 'done'
  if (!s.phoneVerified) return 'phone'
  if (s.requireDocument && !s.docVerified) return 'document'
  if (s.requireFace && !s.faceVerified) return 'face'
  return 'done'
}

export default function KycModal({ open, onClose, onApproved }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [phone, setPhone] = useState('')
  const [phoneLocked, setPhoneLocked] = useState(false)
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)

  const [fullName, setFullName] = useState('')
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>('philid')
  const [idImage, setIdImage] = useState<string | null>(null)
  const idInputRef = useRef<HTMLInputElement>(null)

  const [requireDocument, setRequireDocument] = useState(true)
  const [requireFace, setRequireFace] = useState(true)

  useEffect(() => {
    if (!open) return
    setError(null)
    void fetchKycStatus().then((s) => {
      setRequireDocument(s.requireDocument)
      setRequireFace(s.requireFace)
      setStep(resolveStep(s))
      if (s.registeredPhone) {
        setPhone(s.registeredPhone)
        setPhoneLocked(true)
      } else if (s.phone) {
        setPhone(s.phone)
      }
      if (s.fullName) setFullName(s.fullName)
      if (s.docType && DOC_TYPES.includes(s.docType as typeof docType)) {
        setDocType(s.docType as typeof docType)
      }
    }).catch(() => {})
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
      setError(e instanceof ApiError ? e.message : t('auth.loginFailed'))
    } finally { setLoading(false) }
  }

  async function onVerifyCode() {
    if (!code.trim()) { setError(t('kyc.fillAll')); return }
    setLoading(true); setError(null)
    try {
      const res = await verifyKycOtp(code.trim())
      if (res.status === 'approved') {
        setStep('done')
        onApproved?.()
      } else {
        setStep('document')
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('kyc.rejected'))
    } finally { setLoading(false) }
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return
    try {
      const dataUrl = await compressImage(file)
      setIdImage(dataUrl)
    } catch {
      setError(t('kyc.rejected'))
    }
  }

  async function onSubmitDoc() {
    if (!fullName.trim() || !idImage) {
      setError(t('kyc.fillAll')); return
    }
    setLoading(true); setError(null)
    try {
      const res = await submitKycDocument({
        fullName: fullName.trim(),
        docType,
        idImage,
      })
      if (res.docVerified) {
        if (res.status === 'approved') {
          setStep('done')
          onApproved?.()
        } else {
          setStep('face')
        }
      } else {
        setError(res.rejectReason ? translateRejectReason(res.rejectReason, t) : t('kyc.rejected'))
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('kyc.rejected'))
    } finally { setLoading(false) }
  }

  async function onSubmitFace(frames: Array<{ action: LivenessAction; image: string }>) {
    setLoading(true); setError(null)
    try {
      const res = await submitKycFace(frames)
      if (res.faceVerified) {
        setStep('done')
        onApproved?.()
      } else {
        setError(res.rejectReason ? translateRejectReason(res.rejectReason, t) : t('kyc.rejected'))
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('kyc.rejected'))
    } finally { setLoading(false) }
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
          <h2 className="text-lg font-black text-foreground">{t('kyc.title')}</h2>
        </div>
        <p className="mb-5 text-xs text-muted-foreground">{t('kyc.subtitle')}</p>

        <div className="mb-5 flex items-center gap-1 text-[10px] font-bold">
          <span className={step === 'phone' ? 'text-primary' : ['document', 'face', 'done'].includes(step) ? 'text-emerald-400' : 'text-muted-foreground'}>
            {t('kyc.stepPhone')}
          </span>
          {requireDocument && (
            <>
              <span className="h-px w-2 bg-border" />
              <span className={step === 'document' ? 'text-primary' : ['face', 'done'].includes(step) ? 'text-emerald-400' : 'text-muted-foreground'}>
                {t('kyc.stepDocument')}
              </span>
            </>
          )}
          {requireFace && (
            <>
              <span className="h-px w-2 bg-border" />
              <span className={step === 'face' ? 'text-primary' : step === 'done' ? 'text-emerald-400' : 'text-muted-foreground'}>
                {t('kyc.stepFace')}
              </span>
            </>
          )}
        </div>

        {step === 'phone' && (
          <div className="space-y-3">
            <input value={phone} type="tel" placeholder={t('auth.phonePlaceholder')} className={`${inputCls}${phoneLocked ? ' opacity-60' : ''}`} readOnly={phoneLocked} onChange={(e) => setPhone(e.target.value)} />
            {phoneLocked && <p className="text-[10px] text-muted-foreground">{t('kyc.phoneLocked')}</p>}
            <button type="button" className="w-full rounded-xl border border-border bg-secondary py-3 text-sm font-bold text-foreground disabled:opacity-50" disabled={loading || resendIn > 0} onClick={() => void onSendCode()}>
              {resendIn > 0 ? t('kyc.resendIn', { s: resendIn }) : t('kyc.sendCode')}
            </button>
            <input value={code} type="text" inputMode="numeric" maxLength={6} placeholder={t('kyc.codeLabel')} className={inputCls} onChange={(e) => setCode(e.target.value)} />
            <button type="button" className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50" disabled={loading} onClick={() => void onVerifyCode()}>
              {loading ? <Loader2 size={16} className="mx-auto animate-spin" /> : t('kyc.verify')}
            </button>
          </div>
        )}

        {step === 'document' && (
          <div className="space-y-3">
            <input value={fullName} type="text" placeholder={t('kyc.fullName')} className={inputCls} onChange={(e) => setFullName(e.target.value)} />
            <select value={docType} className={inputCls} onChange={(e) => setDocType(e.target.value as typeof docType)}>
              <option value="philid">{t('kyc.docPhilid')}</option>
              <option value="passport">{t('kyc.docPassport')}</option>
              <option value="drivers_license">{t('kyc.docDriversLicense')}</option>
              <option value="umid">{t('kyc.docUmid')}</option>
            </select>

            <input ref={idInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPickImage(e.target.files?.[0])} />
            <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary py-3 text-sm font-bold text-foreground" onClick={() => idInputRef.current?.click()}>
              {idImage ? <Check size={16} className="text-emerald-400" /> : <Upload size={16} />}
              {idImage ? `${t('kyc.uploadId')} ✓` : t('kyc.uploadId')}
            </button>
            {idImage && <img src={idImage} alt="id" className="max-h-32 w-full rounded-xl object-contain" />}

            <button type="button" className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50" disabled={loading} onClick={() => void onSubmitDoc()}>
              {loading ? <Loader2 size={16} className="mx-auto animate-spin" /> : t('kyc.submit')}
            </button>
          </div>
        )}

        {step === 'face' && (
          <FaceLivenessCapture loading={loading} onComplete={(frames) => void onSubmitFace(frames)} />
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15">
              <Check size={28} className="text-emerald-400" />
            </div>
            <p className="text-sm font-black text-foreground">{t('kyc.approved')}</p>
            <button type="button" className="mt-2 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground" onClick={onClose}>
              {t('kyc.close')}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>,
    document.body,
  )
}
