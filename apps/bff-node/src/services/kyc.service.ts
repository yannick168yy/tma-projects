import { randomInt } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import type { KycSubmission, LivenessAction, LivenessFrameMeta } from '../types/domain.js'
import { normalizePhonePH } from '../utils/phone.js'
import { nowIso } from '../utils/format.js'
import { getSmsProvider, isSmsTestModeEnabled } from './sms/index.js'
import { appendSmsSendLog } from './sms/send-log.js'
import { getStorageProvider } from './storage/index.js'
import {
  findKycByExtractedIdNo,
  findKycByVerifiedPhone,
  getKyc,
  getUser,
  getUserByPhoneAccount,
  saveKyc,
} from './store/index.js'

const MODEL = 'gemini-2.5-flash'
const OTP_TTL_SEC = 300
const RESEND_INTERVAL_SEC = 60
const MAX_VERIFY_ATTEMPTS = 5
const ACCEPTED_DOC_TYPES = ['passport', 'drivers_license', 'philid', 'umid']
const REQUIRED_LIVENESS_ACTIONS: LivenessAction[] = ['neutral', 'blink', 'mouth']
const VERIFY_RL_WINDOW_SEC = 86400

/** 每用户每日证件/人脸提交频控，防刷 Gemini 调用 */
async function enforceVerifyRateLimit(
  redis: Redis,
  env: Env,
  userId: string,
  kind: 'doc' | 'face',
): Promise<void> {
  const key = `kyc:rl:${kind}:${userId}`
  const n = await redis.incr(key)
  if (n === 1) await redis.expire(key, VERIFY_RL_WINDOW_SEC)
  if (n > env.KYC_VERIFY_MAX_PER_DAY) {
    throw new KycError('实名认证尝试过于频繁，请 24 小时后再试', 429)
  }
}

const idLockKey = (idNo: string) => `kyc:idlock:${idNo}`

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

export function buildKycStatusResponse(kyc: KycSubmission | null) {
  return {
    status: kyc?.status ?? 'none',
    phoneVerified: kyc?.phoneVerified ?? false,
    docVerified: kyc?.docVerified ?? false,
    faceVerified: kyc?.faceVerified ?? false,
    phone: kyc?.phone ?? null,
    fullName: kyc?.fullName || null,
    docType: kyc?.docType ?? null,
    rejectReason: kyc?.rejectReason ?? null,
    rejectStep: kyc?.rejectStep ?? null,
  }
}

/** 后台人工复核：通过=放行提现闸门，拒绝=撤销/驳回 */
export async function adminReviewKyc(
  redis: Redis,
  userId: string,
  decision: 'approved' | 'rejected',
  adminUsername: string,
  note?: string,
): Promise<KycSubmission['status']> {
  const existing = await getKyc(redis, userId)
  if (!existing) throw new KycError('KYC 记录不存在', 404)

  const now = nowIso()
  await saveKyc(redis, {
    ...existing,
    status: decision,
    docVerified: decision === 'approved' ? true : existing.docVerified,
    faceVerified: decision === 'approved' ? true : existing.faceVerified,
    rejectReason: decision === 'rejected' ? note?.trim() || '人工审核未通过' : undefined,
    rejectStep: undefined,
    reviewedAt: now,
    reviewedBy: adminUsername,
  })
  return decision
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

  const user = await getUser(redis, userId)
  if (user?.phoneAccount) {
    const bound = normalizePhonePH(user.phoneAccount)
    if (bound && bound !== phone) {
      throw new KycError('请使用注册时绑定的手机号进行验证', 400)
    }
  }

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
    rejectReason: undefined,
    rejectStep: undefined,
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

interface GeminiDocVerdict {
  isValidDocument: boolean
  docType: string
  fullName: string
  idNumber: string
  dob: string
  nameMatches: boolean
  confidence: number
  reasons: string[]
}

interface GeminiFaceVerdict {
  isLivePerson: boolean
  blinkDetected: boolean
  mouthOpenDetected: boolean
  samePersonAcrossFrames: boolean
  faceMatchWithId: number
  confidence: number
  reasons: string[]
}

function stripBase64(input: string): { data: string; mimeType: string } {
  const m = input.match(/^data:([^;]+);base64,(.*)$/)
  if (m) return { mimeType: m[1], data: m[2] }
  return { mimeType: 'image/jpeg', data: input }
}

async function runGeminiDocument(env: Env, fullName: string, idImage: string): Promise<GeminiDocVerdict> {
  if (!env.GEMINI_API_KEY) throw new KycError('KYC verification is not configured', 503)
  const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = ai.getGenerativeModel({ model: MODEL })

  const prompt = `You are a KYC document verification system. Analyze the provided ID document image only.

Accepted document types: passport, drivers_license, philid (Philippine National ID), umid.
The user claims their full name is: "${fullName}".

Return ONLY a valid JSON object (no markdown) with exactly these keys:
{
  "isValidDocument": boolean,
  "docType": string,
  "fullName": string,
  "idNumber": string,
  "dob": string,
  "nameMatches": boolean,
  "confidence": number,
  "reasons": string[]
}`

  const idImg = stripBase64(idImage)
  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: idImg.mimeType, data: idImg.data } },
  ])
  const text = result.response.text().trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new KycError('证件识别失败，请重试', 502)
  return JSON.parse(jsonMatch[0]) as GeminiDocVerdict
}

async function runGeminiFace(
  env: Env,
  idImageBase64: string,
  frames: Array<{ action: LivenessAction; image: string }>,
): Promise<GeminiFaceVerdict> {
  if (!env.GEMINI_API_KEY) throw new KycError('KYC verification is not configured', 503)
  const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  const model = ai.getGenerativeModel({ model: MODEL })

  const prompt = `You are a KYC liveness and face-matching system. You receive:
1. An ID document photo (reference face on the document)
2. Three live camera frames from the same person: neutral (look straight), blink (eyes closed/blinking), mouth (mouth open)

Verify:
- All three frames show the same live person (not a photo of a photo or screen)
- The blink frame shows eyes closed or mid-blink
- The mouth frame shows mouth clearly open
- The live person matches the face on the ID document

Return ONLY a valid JSON object (no markdown) with exactly these keys:
{
  "isLivePerson": boolean,
  "blinkDetected": boolean,
  "mouthOpenDetected": boolean,
  "samePersonAcrossFrames": boolean,
  "faceMatchWithId": number,
  "confidence": number,
  "reasons": string[]
}
faceMatchWithId is 0..1 similarity between live face and ID photo face.`

  const idImg = stripBase64(idImageBase64)
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
    { text: 'ID document image:' },
    { inlineData: { mimeType: idImg.mimeType, data: idImg.data } },
  ]
  for (const frame of frames) {
    const img = stripBase64(frame.image)
    parts.push({ text: `Live frame (${frame.action}):` })
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
  }

  const result = await model.generateContent(parts)
  const text = result.response.text().trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new KycError('人脸识别失败，请重试', 502)
  return JSON.parse(jsonMatch[0]) as GeminiFaceVerdict
}

export async function submitKycDocument(
  redis: Redis,
  env: Env,
  userId: string,
  input: { fullName: string; docType: string; idImage: string },
): Promise<{ docVerified: boolean; status: KycSubmission['status']; rejectReason?: string; rejectStep?: string }> {
  const existing = await getKyc(redis, userId)
  if (!existing?.phoneVerified) {
    throw new KycError('请先完成手机验证', 400)
  }
  await enforceVerifyRateLimit(redis, env, userId, 'doc')

  const verdict = await runGeminiDocument(env, input.fullName, input.idImage)

  if (verdict.idNumber) {
    const owner = await findKycByExtractedIdNo(redis, verdict.idNumber, userId)
    if (owner) throw new KycError('该证件已被其他账号用于实名认证', 409)
  }

  const storage = getStorageProvider(env)
  const ts = Date.now()
  let docImageKey: string | undefined
  try {
    const idImg = stripBase64(input.idImage)
    docImageKey = await storage.put(`${userId}/${ts}_id.jpg`, Buffer.from(idImg.data, 'base64'), idImg.mimeType)
  } catch (e) {
    console.error('[kyc] store doc image failed:', e)
  }

  const reasons: string[] = []
  if (!verdict.isValidDocument) reasons.push('证件无效或无法识别')
  if (!ACCEPTED_DOC_TYPES.includes(verdict.docType)) reasons.push('不支持的证件类型')
  if (!verdict.nameMatches) reasons.push('证件姓名与填写不符')
  if (verdict.confidence < env.KYC_GEMINI_MIN_CONFIDENCE) reasons.push('证件真实性置信度不足')

  const docVerified = reasons.length === 0
  const now = nowIso()
  const submission: KycSubmission = {
    ...existing,
    submissionId: userId,
    userId,
    status: docVerified ? 'pending' : 'rejected',
    fullName: input.fullName,
    docType: input.docType,
    verifyMode: 'document',
    docVerified,
    faceVerified: false,
    extractedIdNo: verdict.idNumber || undefined,
    geminiConfidence: verdict.confidence,
    geminiResult: { document: verdict },
    docImageKey,
    rejectReason: docVerified ? undefined : reasons.join('；'),
    rejectStep: docVerified ? undefined : 'document',
    submittedAt: now,
    docSubmittedAt: now,
    livenessFrames: undefined,
    selfieImageKey: undefined,
    faceSubmittedAt: undefined,
    reviewedAt: undefined,
    reviewedBy: undefined,
  }
  await saveKyc(redis, submission)
  return {
    docVerified,
    status: submission.status,
    rejectReason: submission.rejectReason,
    rejectStep: submission.rejectStep,
  }
}

export async function submitKycFace(
  redis: Redis,
  env: Env,
  userId: string,
  frames: Array<{ action: LivenessAction; image: string }>,
): Promise<{ faceVerified: boolean; status: KycSubmission['status']; rejectReason?: string; rejectStep?: string }> {
  const existing = await getKyc(redis, userId)
  if (!existing?.phoneVerified) throw new KycError('请先完成手机验证', 400)
  if (!existing.docVerified || !existing.docImageKey) {
    throw new KycError('请先完成证件验证', 400)
  }

  const actions = frames.map((f) => f.action)
  for (const required of REQUIRED_LIVENESS_ACTIONS) {
    if (!actions.includes(required)) {
      throw new KycError(`缺少活体帧: ${required}`, 400)
    }
  }

  await enforceVerifyRateLimit(redis, env, userId, 'face')

  const storage = getStorageProvider(env)
  const docFile = await storage.get(existing.docImageKey)
  if (!docFile) throw new KycError('证件图片不存在，请重新提交证件', 400)

  const idImageBase64 = `data:${docFile.mimeType};base64,${docFile.data.toString('base64')}`
  const verdict = await runGeminiFace(env, idImageBase64, frames)

  const ts = Date.now()
  const livenessFrames: LivenessFrameMeta[] = []
  try {
    for (const frame of frames) {
      const img = stripBase64(frame.image)
      const key = await storage.put(
        `${userId}/${ts}_${frame.action}.jpg`,
        Buffer.from(img.data, 'base64'),
        img.mimeType,
      )
      livenessFrames.push({ action: frame.action, key, capturedAt: nowIso() })
    }
  } catch (e) {
    console.error('[kyc] store liveness frames failed:', e)
  }

  const reasons: string[] = []
  if (!verdict.isLivePerson) reasons.push('未检测到真人')
  if (!verdict.blinkDetected) reasons.push('未检测到眨眼动作')
  if (!verdict.mouthOpenDetected) reasons.push('未检测到张嘴动作')
  if (!verdict.samePersonAcrossFrames) reasons.push('活体帧非同一人')
  if ((verdict.faceMatchWithId ?? 0) < 0.8) reasons.push('人脸与证件照不匹配')
  if (verdict.confidence < env.KYC_GEMINI_MIN_CONFIDENCE) reasons.push('活体置信度不足')

  const faceVerified = reasons.length === 0
  const now = nowIso()
  const submission: KycSubmission = {
    ...existing,
    status: faceVerified ? 'approved' : 'rejected',
    verifyMode: 'face',
    faceVerified,
    geminiResult: { ...(existing.geminiResult ?? {}), face: verdict },
    geminiConfidence: verdict.confidence,
    livenessFrames,
    selfieImageKey: livenessFrames[0]?.key,
    rejectReason: faceVerified ? undefined : reasons.join('；'),
    rejectStep: faceVerified ? undefined : 'face',
    faceSubmittedAt: now,
    reviewedAt: faceVerified ? now : undefined,
  }

  // 通过的那一刻再查一次证件防重，并用锁串行化同证件的并发提交，消除「先后通过」竞态
  if (faceVerified && existing.extractedIdNo) {
    const lockKey = idLockKey(existing.extractedIdNo)
    const locked = await redis.set(lockKey, userId, 'EX', 30, 'NX')
    if (!locked) throw new KycError('该证件正在被其他账号验证，请稍后再试', 409)
    try {
      const owner = await findKycByExtractedIdNo(redis, existing.extractedIdNo, userId)
      if (owner) throw new KycError('该证件已被其他账号用于实名认证', 409)
      await saveKyc(redis, submission)
    } finally {
      await redis.del(lockKey)
    }
  } else {
    await saveKyc(redis, submission)
  }
  return {
    faceVerified,
    status: submission.status,
    rejectReason: submission.rejectReason,
    rejectStep: submission.rejectStep,
  }
}

/** @deprecated 兼容旧客户端，仅执行证件步骤 */
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
  const docResult = await submitKycDocument(redis, env, userId, {
    fullName: input.fullName,
    docType: input.docType,
    idImage: input.idImage,
  })
  if (!docResult.docVerified) {
    return { status: docResult.status, rejectReason: docResult.rejectReason }
  }
  if (input.verifyMode === 'face' && input.selfieImage) {
    const faceResult = await submitKycFace(redis, env, userId, [
      { action: 'neutral', image: input.selfieImage },
      { action: 'blink', image: input.selfieImage },
      { action: 'mouth', image: input.selfieImage },
    ])
    return { status: faceResult.status, rejectReason: faceResult.rejectReason }
  }
  return { status: docResult.status, rejectReason: docResult.rejectReason }
}
