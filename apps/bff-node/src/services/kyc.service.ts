import { randomInt } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import type { KycSubmission } from '../types/domain.js'
import { normalizePhonePH } from '../utils/phone.js'
import { nowIso } from '../utils/format.js'
import { getSmsProvider, isSmsTestModeEnabled } from './sms/index.js'
import { appendSmsSendLog } from './sms/send-log.js'
import { getStorageProvider } from './storage/index.js'
import {
  findKycByExtractedIdNo,
  findKycByVerifiedPhone,
  getKyc,
  getUserByPhoneAccount,
  saveKyc,
} from './store/index.js'

const MODEL = 'gemini-2.5-flash'
const OTP_TTL_SEC = 300
const RESEND_INTERVAL_SEC = 60
const MAX_VERIFY_ATTEMPTS = 5
const ACCEPTED_DOC_TYPES = ['passport', 'drivers_license', 'philid', 'umid']

export class KycError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'KycError'
    this.status = status
  }
}

/** 取款硬闸门：是否已通过 KYC 实名 */
export async function isKycApproved(redis: Redis, userId: string): Promise<boolean> {
  const kyc = await getKyc(redis, userId)
  return kyc?.status === 'approved'
}

const otpKey = (userId: string) => `kyc:otp:${userId}`
const resendKey = (userId: string) => `kyc:otp:sent:${userId}`

interface OtpState {
  code: string
  phone: string
  attempts: number
}

export async function sendKycOtp(
  redis: Redis,
  env: Env,
  userId: string,
  phoneRaw: string,
): Promise<{ phone: string; resendInSec: number }> {
  const phone = normalizePhonePH(phoneRaw)
  if (!phone) throw new KycError('Invalid phone number', 400)

  // 全局互斥：该手机不能是他号的 KYC 手机，也不能是他号的手机登录号
  const otherOwner = await findKycByVerifiedPhone(redis, phone, userId)
  if (otherOwner) throw new KycError('该手机号已被其他账号使用', 409)
  const phoneAccountOwner = await getUserByPhoneAccount(redis, phone)
  if (phoneAccountOwner && phoneAccountOwner.id !== userId) {
    throw new KycError('该手机号已被其他账号使用', 409)
  }

  if (await redis.get(resendKey(userId))) {
    throw new KycError('请求过于频繁，请稍后再试', 429)
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const state: OtpState = { code, phone, attempts: 0 }
  await redis.set(otpKey(userId), JSON.stringify(state), 'EX', OTP_TTL_SEC)
  await redis.set(resendKey(userId), '1', 'EX', RESEND_INTERVAL_SEC)

  const text = `Your verification code is ${code}. Valid for 5 minutes. Do not share it.`
  const mocked = await isSmsTestModeEnabled(redis, env)
  const res = await (await getSmsProvider(env, redis)).sendSms(phone, text)
  if (!res.ok) {
    await redis.del(otpKey(userId), resendKey(userId))
    throw new KycError(`短信发送失败${res.errCode ? `(${res.errCode})` : ''}`, 502)
  }
  await appendSmsSendLog(redis, {
    scene: 'kyc_otp',
    userId,
    phone,
    code,
    text,
    mocked,
  })
  return { phone, resendInSec: RESEND_INTERVAL_SEC }
}

export async function verifyKycOtp(
  redis: Redis,
  userId: string,
  code: string,
): Promise<{ phoneVerified: true }> {
  const raw = await redis.get(otpKey(userId))
  if (!raw) throw new KycError('验证码已过期，请重新获取', 400)
  const state = JSON.parse(raw) as OtpState

  if (state.attempts >= MAX_VERIFY_ATTEMPTS) {
    await redis.del(otpKey(userId))
    throw new KycError('尝试次数过多，请重新获取验证码', 429)
  }
  if (code !== state.code) {
    state.attempts += 1
    const ttl = await redis.ttl(otpKey(userId))
    await redis.set(otpKey(userId), JSON.stringify(state), 'EX', ttl > 0 ? ttl : OTP_TTL_SEC)
    throw new KycError('验证码错误', 400)
  }

  await redis.del(otpKey(userId))
  const existing = await getKyc(redis, userId)
  await saveKyc(redis, {
    ...(existing ?? blankSubmission(userId)),
    userId,
    phone: state.phone,
    phoneVerified: true,
    status: existing?.status === 'approved' ? 'approved' : 'pending',
  })
  return { phoneVerified: true }
}

function blankSubmission(userId: string): KycSubmission {
  return {
    submissionId: userId,
    userId,
    status: 'none',
    fullName: '',
    gender: '',
    dob: '',
    submittedAt: nowIso(),
  }
}

interface GeminiVerdict {
  isValidDocument: boolean
  docType: string
  fullName: string
  idNumber: string
  dob: string
  nameMatches: boolean
  faceMatch: number | null
  confidence: number
  reasons: string[]
}

function stripBase64(input: string): { data: string; mimeType: string } {
  const m = input.match(/^data:([^;]+);base64,(.*)$/)
  if (m) return { mimeType: m[1], data: m[2] }
  return { mimeType: 'image/jpeg', data: input }
}

async function runGemini(
  env: Env,
  input: { fullName: string; verifyMode: 'document' | 'face'; idImage: string; selfieImage?: string },
): Promise<GeminiVerdict> {
  if (!env.GEMINI_API_KEY) throw new KycError('KYC verification is not configured', 503)
  const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = ai.getGenerativeModel({ model: MODEL })

  const prompt = `You are a KYC document verification system for a gaming platform. Analyze the provided ID document image${input.verifyMode === 'face' ? ' and the selfie photo' : ''}.

Accepted document types: passport, drivers_license, philid (Philippine National ID), umid.
The user claims their full name is: "${input.fullName}".

Return ONLY a valid JSON object (no markdown, no commentary) with exactly these keys:
{
  "isValidDocument": boolean,   // true if it is a genuine, unaltered, readable government ID (not a screenshot of a screen, not obviously edited)
  "docType": string,            // one of the accepted types, or "unknown"
  "fullName": string,           // full name printed on the document
  "idNumber": string,           // the document/ID number
  "dob": string,                // date of birth on the document, ISO if possible
  "nameMatches": boolean,       // does the document name match the claimed name (allow ordering/diacritics differences)
  "faceMatch": number,          // ${input.verifyMode === 'face' ? '0..1 similarity between the selfie face and the ID photo' : 'always null'}
  "confidence": number,         // 0..1 overall confidence that this is an authentic document for the claimed person
  "reasons": string[]           // short reasons supporting the decision
}`

  const idImg = stripBase64(input.idImage)
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
    { inlineData: { mimeType: idImg.mimeType, data: idImg.data } },
  ]
  if (input.verifyMode === 'face' && input.selfieImage) {
    const selfie = stripBase64(input.selfieImage)
    parts.push({ inlineData: { mimeType: selfie.mimeType, data: selfie.data } })
  }

  const result = await model.generateContent(parts)
  const text = result.response.text().trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new KycError('证件识别失败，请重试', 502)
  return JSON.parse(jsonMatch[0]) as GeminiVerdict
}

export async function submitKyc(
  redis: Redis,
  env: Env,
  userId: string,
  input: {
    fullName: string
    docType: string
    verifyMode: 'document' | 'face'
    idImage: string
    selfieImage?: string
  },
): Promise<{ status: KycSubmission['status']; rejectReason?: string }> {
  const existing = await getKyc(redis, userId)
  if (!existing?.phoneVerified) {
    throw new KycError('请先完成手机验证', 400)
  }
  if (input.verifyMode === 'face' && !input.selfieImage) {
    throw new KycError('人脸识别需要上传自拍照', 400)
  }

  const verdict = await runGemini(env, {
    fullName: input.fullName,
    verifyMode: input.verifyMode,
    idImage: input.idImage,
    selfieImage: input.selfieImage,
  })

  // 防重：同一证件号不可用于多个账号
  if (verdict.idNumber) {
    const owner = await findKycByExtractedIdNo(redis, verdict.idNumber, userId)
    if (owner) throw new KycError('该证件已被其他账号用于实名认证', 409)
  }

  // 存证件图（审计/合规留痕）
  const storage = getStorageProvider(env)
  const ts = Date.now()
  let docImageKey: string | undefined
  let selfieImageKey: string | undefined
  try {
    const idImg = stripBase64(input.idImage)
    docImageKey = await storage.put(`${userId}/${ts}_id.jpg`, Buffer.from(idImg.data, 'base64'), idImg.mimeType)
    if (input.verifyMode === 'face' && input.selfieImage) {
      const selfie = stripBase64(input.selfieImage)
      selfieImageKey = await storage.put(`${userId}/${ts}_selfie.jpg`, Buffer.from(selfie.data, 'base64'), selfie.mimeType)
    }
  } catch (e) {
    console.error('[kyc] store image failed:', e)
  }

  const reasons: string[] = []
  if (!verdict.isValidDocument) reasons.push('证件无效或无法识别')
  if (!ACCEPTED_DOC_TYPES.includes(verdict.docType)) reasons.push('不支持的证件类型')
  if (!verdict.nameMatches) reasons.push('证件姓名与填写不符')
  if (verdict.confidence < env.KYC_GEMINI_MIN_CONFIDENCE) reasons.push('证件真实性置信度不足')
  if (input.verifyMode === 'face' && (verdict.faceMatch ?? 0) < 0.8) reasons.push('人脸与证件照不匹配')

  const approved = reasons.length === 0
  const submission: KycSubmission = {
    ...existing,
    submissionId: userId,
    userId,
    status: approved ? 'approved' : 'rejected',
    fullName: input.fullName,
    docType: input.docType,
    verifyMode: input.verifyMode,
    extractedIdNo: verdict.idNumber || undefined,
    geminiConfidence: verdict.confidence,
    geminiResult: verdict as unknown as Record<string, unknown>,
    docImageKey,
    selfieImageKey,
    rejectReason: approved ? undefined : reasons.join('；'),
    submittedAt: nowIso(),
  }
  await saveKyc(redis, submission)
  return { status: submission.status, rejectReason: submission.rejectReason }
}
