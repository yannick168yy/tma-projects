import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { fetchKycStatus, sendKycOtp, submitKycDocument, submitKycFace, verifyKycOtp } from '@/api/kyc'

export const DOC_TYPES = ['passport', 'drivers_license', 'philid', 'umid', 'acr_icard'] as const
export type DocType = (typeof DOC_TYPES)[number]
export type KycStep = 'phone' | 'document' | 'reviewing' | 'face' | 'done'

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

type Translate = (key: string, opts?: Record<string, unknown>) => string

function translateKycError(message: string, t: Translate, fallback?: string): string {
  if (message.startsWith('kyc.errors.smsFailedWithCode:')) {
    const code = message.slice('kyc.errors.smsFailedWithCode:'.length)
    return t('kyc.errors.smsFailedWithCode', { code })
  }
  if (message.startsWith('kyc.')) return t(message)
  // 后端可能返回未做 key 化的中文文案（如人脸/证件识别失败），用本地化兜底而非原样透传
  return fallback ?? message
}

function translateRejectReason(reason: string, t: Translate): string {
  return reason
    .split(';')
    .map((code) => t(`kyc.reasons.${code.trim()}`, { defaultValue: code.trim() }))
    .join(' · ')
}

function formatDocRejectError(reason: string | null | undefined, t: Translate): string {
  const reasonText = reason ? translateRejectReason(reason, t) : t('kyc.rejected')
  return `${reasonText}. ${t('kyc.docReuploadHint')}`
}

function resolveStep(s: Awaited<ReturnType<typeof fetchKycStatus>>): KycStep {
  if (s.status === 'approved') return 'done'
  if (!s.phoneVerified) return 'phone'
  if (s.requireDocument && !s.docVerified) {
    if (s.status === 'pending') return 'reviewing'
    return 'document'
  }
  if (s.requireFace && !s.faceVerified) return 'face'
  // 被人工驳回/撤销：即便 verified 标志陈旧仍为 true，也不能显示"已通过"，回到重做
  if (s.status === 'rejected') return s.requireDocument ? 'document' : 'face'
  return 'done'
}

/** 实名认证流程的状态与动作，供提现弹窗与 KYC Setting 页共用。active=true 时拉取状态。 */
export function useKycFlow(active: boolean, onApproved?: () => void) {
  const { t } = useTranslation()
  const [step, setStep] = useState<KycStep>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [phone, setPhone] = useState('')
  const [phoneLocked, setPhoneLocked] = useState(false)
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)

  const [fullName, setFullName] = useState('')
  const [docType, setDocType] = useState<DocType>('philid')
  const [idImage, setIdImage] = useState<string | null>(null)
  const [docReuploadRequired, setDocReuploadRequired] = useState(false)
  const idInputRef = useRef<HTMLInputElement>(null)

  const [requireDocument, setRequireDocument] = useState(true)
  const [requireFace, setRequireFace] = useState(true)

  useEffect(() => {
    if (!active) return
    setError(null)
    setDocReuploadRequired(false)
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
      if (s.docType && DOC_TYPES.includes(s.docType as DocType)) {
        setDocType(s.docType as DocType)
      }
      if (s.status === 'rejected' && s.rejectStep === 'document' && !s.docVerified) {
        setIdImage(null)
        setDocReuploadRequired(true)
        setError(formatDocRejectError(s.rejectReason, t))
      } else {
        setIdImage(null)
      }
    }).catch(() => {})
  }, [active, t])

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
      setError(e instanceof ApiError ? translateKycError(e.message, t) : t('auth.loginFailed'))
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
      setError(e instanceof ApiError ? translateKycError(e.message, t, t('kyc.rejected')) : t('kyc.rejected'))
    } finally { setLoading(false) }
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return
    try {
      const dataUrl = await compressImage(file)
      setIdImage(dataUrl)
      setDocReuploadRequired(false)
      setError(null)
    } catch {
      setError(t('kyc.rejected'))
    }
  }

  async function onSubmitDoc() {
    if (!fullName.trim() || !idImage) {
      setError(docReuploadRequired ? formatDocRejectError(null, t) : t('kyc.fillAll'))
      return
    }
    setLoading(true); setError(null)
    try {
      const res = await submitKycDocument({ fullName: fullName.trim(), docType, idImage })
      if (res.docVerified) {
        if (res.status === 'approved') {
          setStep('done')
          onApproved?.()
        } else {
          setStep('face')
        }
      } else if (res.status === 'pending') {
        setStep('reviewing')
      } else {
        setIdImage(null)
        setDocReuploadRequired(true)
        setError(formatDocRejectError(res.rejectReason, t))
      }
    } catch (e) {
      setError(e instanceof ApiError ? translateKycError(e.message, t, t('kyc.docRecognitionFailed')) : t('kyc.rejected'))
    } finally { setLoading(false) }
  }

  async function onSubmitFace(selfieImage: string) {
    setLoading(true); setError(null)
    try {
      const res = await submitKycFace(selfieImage)
      if (res.faceVerified) {
        setStep('done')
        onApproved?.()
      } else {
        setError(res.rejectReason ? translateRejectReason(res.rejectReason, t) : t('kyc.rejected'))
      }
    } catch (e) {
      setError(e instanceof ApiError ? translateKycError(e.message, t, t('kyc.faceFailed')) : t('kyc.rejected'))
    } finally { setLoading(false) }
  }

  return {
    step, requireDocument, requireFace, loading, error,
    phone, setPhone, phoneLocked, code, setCode, resendIn,
    fullName, setFullName, docType, setDocType, idImage, docReuploadRequired, idInputRef,
    onSendCode, onVerifyCode, onPickImage, onSubmitDoc, onSubmitFace,
  }
}

export type KycFlow = ReturnType<typeof useKycFlow>
