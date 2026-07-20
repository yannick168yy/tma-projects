import { apiRequest } from '@/api/client'

export type KycStatusValue = 'none' | 'pending' | 'approved' | 'rejected'
export type KycRejectStep = 'phone' | 'document' | 'face'

export interface KycStatus {
  status: KycStatusValue
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

export function fetchKycStatus(): Promise<KycStatus> {
  return apiRequest<KycStatus>('/kyc/status')
}

export function sendKycOtp(phone: string): Promise<{ phone: string; resendInSec: number }> {
  return apiRequest('/kyc/phone/send-otp', { method: 'POST', body: JSON.stringify({ phone }) })
}

/** password：非手机号注册用户顺带设密码，绑完即可手机+密码登录 */
export function verifyKycOtp(code: string, password?: string): Promise<{ phoneVerified: true; status: KycStatusValue }> {
  return apiRequest('/kyc/phone/verify', { method: 'POST', body: JSON.stringify({ code, password }) })
}

/** OTP 关闭时的直接绑定通道（开关开启时后端会拒绝，须走 sendKycOtp/verifyKycOtp） */
export function bindKycPhone(phone: string, password?: string): Promise<{ phoneVerified: true; status: KycStatusValue }> {
  return apiRequest('/kyc/phone/bind', { method: 'POST', body: JSON.stringify({ phone, password }) })
}

export function submitKycDocument(input: {
  fullName: string
  docType: string
  idImage: string
}): Promise<{ docVerified: boolean; status: KycStatusValue; rejectReason?: string; rejectStep?: string }> {
  return apiRequest('/kyc/document', { method: 'POST', body: JSON.stringify(input) })
}

export function submitKycFace(selfieImage: string): Promise<{
  faceVerified: boolean
  status: KycStatusValue
  rejectReason?: string
  rejectStep?: string
}> {
  return apiRequest('/kyc/face', { method: 'POST', body: JSON.stringify({ selfieImage }) })
}
