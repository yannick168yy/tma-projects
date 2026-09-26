import { apiRequest } from '@/api/client'

export type KycStatusValue = 'none' | 'pending' | 'approved' | 'rejected'
export type KycRejectStep = 'phone' | 'document' | 'face'

export interface KycStatus {
  status: KycStatusValue
  market: 'PH' | 'ID' | 'IN'
  phoneVerified: boolean
  docVerified: boolean
  faceVerified: boolean
  phone: string | null
  fullName: string | null
  docType: string | null
  rejectReason: string | null
  rejectStep: KycRejectStep | null
  /** 是否真的提交过证件（null=从未提交，pending 仅为手机验证完成） */
  docSubmittedAt: string | null
  registeredPhone: string | null
  requirePhone: boolean
  requireDocument: boolean
  requireFace: boolean
}

export function fetchKycStatus(currency?: string): Promise<KycStatus> {
  const query = currency ? `?currency=${encodeURIComponent(currency)}` : ''
  return apiRequest<KycStatus>(`/kyc/status${query}`)
}

/**
 * 前台提现闸门：镜像后端 isKycApproved，按后台当前开关判断是否已满足实名要求。
 * 后台关闭证件+人脸（甚至手机）后须与后端一致地放行，否则前台仍强制弹 KYC 且卡死在 done 步。
 */
export function isKycGatePassed(s: KycStatus): boolean {
  if (s.status === 'approved') return true
  // 手机与证件都关闭 = 实名流程整体关闭，不设闸门
  if (!s.requirePhone && !s.requireDocument) return true
  // 人工驳回/撤销（无 rejectStep）永久拦截，需重新走流程
  if (s.status === 'rejected' && !s.rejectStep) return false
  if (s.requirePhone && !s.phoneVerified) return false
  if (s.requireDocument && !s.docVerified) return false
  if (s.requireFace && !s.faceVerified) return false
  return true
}

export function sendKycOtp(phone: string, currency?: string): Promise<{ phone: string; resendInSec: number }> {
  return apiRequest('/kyc/phone/send-otp', { method: 'POST', body: JSON.stringify({ phone, currency }) })
}

/** password：非手机号注册用户顺带设密码，绑完即可手机+密码登录 */
export function verifyKycOtp(code: string, password?: string, currency?: string): Promise<{ phoneVerified: true; status: KycStatusValue }> {
  return apiRequest('/kyc/phone/verify', { method: 'POST', body: JSON.stringify({ code, password, currency }) })
}

export function submitKycDocument(input: {
  docType: string
  idImage: string
  currency?: string
}): Promise<{ docVerified: boolean; status: KycStatusValue; rejectReason?: string; rejectStep?: string }> {
  return apiRequest('/kyc/document', { method: 'POST', body: JSON.stringify(input), timeoutMs: 70_000 })
}

export function submitKycFace(selfieImage: string, currency?: string): Promise<{
  faceVerified: boolean
  status: KycStatusValue
  rejectReason?: string
  rejectStep?: string
}> {
  return apiRequest('/kyc/face', { method: 'POST', body: JSON.stringify({ selfieImage, currency }), timeoutMs: 70_000 })
}

/** 人脸回退重传时取回已上传的证件图（dataURL；无图返回 null） */
export function fetchKycDocImage(): Promise<{ image: string | null }> {
  return apiRequest('/kyc/document/image')
}
