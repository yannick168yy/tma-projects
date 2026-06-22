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
  registeredPhone: string | null
  requireDocument: boolean
  requireFace: boolean
}

export function fetchKycStatus(): Promise<KycStatus> {
  return apiRequest<KycStatus>('/kyc/status')
}

export function sendKycOtp(phone: string): Promise<{ phone: string; resendInSec: number }> {
  return apiRequest('/kyc/phone/send-otp', { method: 'POST', body: JSON.stringify({ phone }) })
}

export function verifyKycOtp(code: string): Promise<{ phoneVerified: true; status: KycStatusValue }> {
  return apiRequest('/kyc/phone/verify', { method: 'POST', body: JSON.stringify({ code }) })
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
