import { apiRequest } from '@/api/client'

export type KycStatusValue = 'none' | 'pending' | 'approved' | 'rejected'

export interface KycStatus {
  status: KycStatusValue
  phoneVerified: boolean
  phone: string | null
  rejectReason: string | null
}

export function fetchKycStatus(): Promise<KycStatus> {
  return apiRequest<KycStatus>('/kyc/status')
}

export function sendKycOtp(phone: string): Promise<{ phone: string; resendInSec: number }> {
  return apiRequest('/kyc/phone/send-otp', { method: 'POST', body: JSON.stringify({ phone }) })
}

export function verifyKycOtp(code: string): Promise<{ phoneVerified: true }> {
  return apiRequest('/kyc/phone/verify', { method: 'POST', body: JSON.stringify({ code }) })
}

export function submitKyc(input: {
  fullName: string
  docType: string
  verifyMode: 'document' | 'face'
  idImage: string
  selfieImage?: string
}): Promise<{ status: KycStatusValue; rejectReason?: string }> {
  return apiRequest('/kyc/submissions', { method: 'POST', body: JSON.stringify(input) })
}
