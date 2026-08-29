import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { fetchKycDocImage, fetchKycStatus, sendKycOtp, submitKycDocument, submitKycFace, verifyKycOtp } from '@/api/kyc'
import { getAppLocale } from '@/i18n'

export const DOC_TYPES = ['passport', 'drivers_license', 'philid', 'umid', 'acr_icard', 'ktp', 'sim'] as const
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
  if (message.startsWith('errors.')) return t(message)
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

function formatFaceRejectError(reason: string | null | undefined, t: Translate): string {
  const reasonText = reason ? translateRejectReason(reason, t) : t('kyc.rejected')
  return `${reasonText}. ${t('kyc.faceRetryHint')}`
}

// 非"照片质量"类错误(锁定/重复占用/频控)追加重拍提示只会误导,原样展示
const NO_RETRY_HINT_ERRORS = new Set([
  'kyc.errors.docFailureLimitReached',
  'kyc.errors.faceFailureLimitReached',
  'kyc.errors.docAlreadyUsed',
  'kyc.errors.docVerifyBusy',
  'kyc.errors.verifyTooFrequent',
])

// 网络层错误(超时/断网/WAF 拦截页):请求没到业务后端,不是照片质量问题,绝不能提示重拍
function formatNetworkError(e: ApiError, t: Translate): string {
  return e.message.startsWith('errors.') ? t(e.message) : t('errors.networkUnavailable')
}

function formatDocApiError(e: unknown, t: Translate): string {
  if (!(e instanceof ApiError)) return t('kyc.rejected')
  if (e.network) return formatNetworkError(e, t)
  const message = translateKycError(e.message, t, t('kyc.docRecognitionFailed'))
  if (NO_RETRY_HINT_ERRORS.has(e.message)) return message
  return `${message}. ${t('kyc.docReuploadHint')}`
}

function formatFaceApiError(e: unknown, t: Translate): string {
  if (!(e instanceof ApiError)) return t('kyc.rejected')
  if (e.network) return formatNetworkError(e, t)
  const message = translateKycError(e.message, t, t('kyc.faceFailed'))
  if (NO_RETRY_HINT_ERRORS.has(e.message)) return message
  return `${message}. ${t('kyc.faceRetryHint')}`
}

function resolveStep(s: Awaited<ReturnType<typeof fetchKycStatus>>): KycStep {
  if (s.status === 'approved') return 'done'
  if (s.requirePhone && !s.phoneVerified) return 'phone'
  if (s.requireDocument && !s.docVerified) {
    // pending 可能只是"手机验证完成"（领体验金也走这步）：没交过证件就该进证件步骤，而不是显示审核中
    if (s.status === 'pending' && s.docSubmittedAt) return 'reviewing'
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

  const [docType, setDocType] = useState<DocType>(() => getAppLocale() === 'id' ? 'ktp' : 'philid')
  const [idImage, setIdImage] = useState<string | null>(null)
  const [docReuploadRequired, setDocReuploadRequired] = useState(false)
  const idInputRef = useRef<HTMLInputElement>(null)

  const [requirePhone, setRequirePhone] = useState(true)
  const [requireDocument, setRequireDocument] = useState(true)
  const [requireFace, setRequireFace] = useState(true)

  const [faceFailCount, setFaceFailCount] = useState(0)
  const [suggestDocRedo, setSuggestDocRedo] = useState(false)
  const [docRedoMode, setDocRedoMode] = useState(false)
  const [prevDocImage, setPrevDocImage] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    setError(null)
    setDocReuploadRequired(false)
    setFaceFailCount(0)
    setSuggestDocRedo(false)
    setDocRedoMode(false)
    setPrevDocImage(null)
    void fetchKycStatus().then((s) => {
      setRequirePhone(s.requirePhone)
      setRequireDocument(s.requireDocument)
      setRequireFace(s.requireFace)
      setStep(resolveStep(s))
      if (s.registeredPhone) {
        setPhone(s.registeredPhone)
        setPhoneLocked(true)
      } else if (s.phone) {
        setPhone(s.phone)
      }
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
    if (!idImage) {
      setError(docReuploadRequired ? formatDocRejectError(null, t) : t('kyc.fillAll'))
      return
    }
    setLoading(true); setError(null)
    // 提交新证件即视为放弃"继续人脸"捷径:提交结果可能覆盖服务端已通过的旧证件,之后按常规被拒/重传流程走
    setDocRedoMode(false)
    try {
      const res = await submitKycDocument({ docType, idImage })
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
      setError(formatDocApiError(e, t))
    } finally { setLoading(false) }
  }

  // 人脸反复不过(尤其与证件照不符/被锁)时,问题可能出在证件照本身,露出"回去重传证件"的出口
  function recordFaceFailure(reason: string) {
    const next = faceFailCount + 1
    setFaceFailCount(next)
    if (next >= 2 || reason.includes('face_id_mismatch') || reason === 'kyc.errors.faceFailureLimitReached') {
      setSuggestDocRedo(true)
    }
  }

  // 非破坏性回退:已通过的证件保留在服务端,展示旧图,由用户决定重新上传还是继续人脸
  async function backToDocument() {
    setStep('document')
    setDocRedoMode(true)
    setError(null)
    setFaceFailCount(0)
    setSuggestDocRedo(false)
    if (idImage) {
      // 本会话内刚传过:直接用本地图展示,idImage 腾出来放新选的图
      setPrevDocImage(idImage)
      setIdImage(null)
    } else if (!prevDocImage) {
      try {
        const res = await fetchKycDocImage()
        setPrevDocImage(res.image)
      } catch {
        // 取不到旧图只是少一张预览,不阻塞流程
      }
    }
  }

  function continueToFace() {
    setDocRedoMode(false)
    setError(null)
    setStep('face')
  }

  async function onSubmitFace(selfieImage: string) {
    setLoading(true); setError(null)
    try {
      const res = await submitKycFace(selfieImage)
      if (res.faceVerified) {
        setStep('done')
        onApproved?.()
      } else {
        recordFaceFailure(res.rejectReason ?? '')
        setError(formatFaceRejectError(res.rejectReason, t))
      }
    } catch (e) {
      // 网络层错误不算人脸失败:请求可能根本没到后端
      if (e instanceof ApiError && !e.network) recordFaceFailure(e.message)
      setError(formatFaceApiError(e, t))
    } finally { setLoading(false) }
  }

  return {
    step, requirePhone, requireDocument, requireFace, loading, error,
    phone, setPhone, phoneLocked, code, setCode, resendIn,
    docType, setDocType, idImage, docReuploadRequired, idInputRef,
    suggestDocRedo, backToDocument, docRedoMode, prevDocImage, continueToFace,
    onSendCode, onVerifyCode, onPickImage, onSubmitDoc, onSubmitFace,
  }
}

export type KycFlow = ReturnType<typeof useKycFlow>
