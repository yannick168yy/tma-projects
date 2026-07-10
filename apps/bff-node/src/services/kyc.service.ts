import { randomInt } from 'node:crypto'
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import type { KycSubmission, LivenessFrameMeta } from '../types/domain.js'
import { normalizePhonePH } from '../utils/phone.js'
import { nowIso } from '../utils/format.js'
import { getAdminSetting } from './admin-store.js'
import { ensureBirthdayFromKyc } from './vip.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getSmsProvider, isSmsTestModeEnabled } from './sms/index.js'
import { appendSmsSendLog } from './sms/send-log.js'
import {
  enforceSmsDailyLimit,
  getKycDocFailureLimit,
  getKycFaceFailureLimit,
  getOtpLockSeconds,
  getSmsDailyIpLimit,
  getSmsDailyLimit,
  recordSmsSent,
} from './otp-policy.service.js'
import { getStorageProvider } from './storage/index.js'
import { broadcastBadges } from './sse-badges.js'
import {
  findKycByExtractedIdNo,
  findKycByVerifiedPhone,
  getKyc,
  getUser,
  getUserByPhoneAccount,
  listUserIdentities,
  saveKyc,
} from './store/index.js'

/** lite 探路 → 2.5 主力 → 1.5 兜底；lite 失败不等待，直接切下一模型 */
const GEMINI_MODEL_CHAIN = [
  { model: 'gemini-2.5-flash-lite', maxAttempts: 1 },
  { model: 'gemini-2.5-flash', maxAttempts: 3 },
  { model: 'gemini-1.5-flash', maxAttempts: 3 },
] as const
const GEMINI_PRIMARY_MODEL = GEMINI_MODEL_CHAIN[0].model
const GEMINI_RETRY_DELAY_CAP_MS = 60_000
const GEMINI_RETRY_DELAY_FALLBACK_MS = 5_000
const OTP_TTL_SEC = 300
const RESEND_INTERVAL_SEC = 60
const MAX_VERIFY_ATTEMPTS = 3
const KYC_FAILURE_LOCK_SECONDS = 180
const ACCEPTED_DOC_TYPES = ['passport', 'drivers_license', 'philid', 'umid', 'acr_icard']

function normalizeDocType(raw: string): string {
  const s = raw.toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (s === 'acr_i_card' || s === 'i_card' || s === 'icard') return 'acr_icard'
  return s
}
const VERIFY_RL_WINDOW_SEC = 86400

/** 人脸 vs 证件照相似度通过阈值：后台 kyc_face_match_threshold 优先，否则用 env 兜底 */
async function getKycFaceMatchThreshold(env: Env): Promise<number> {
  const raw = await getAdminSetting(env, 'kyc_face_match_threshold')
  const n = raw != null ? Number(raw) : NaN
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n
  return env.KYC_FACE_MATCH_MIN
}

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

/** 通过落库时用证件号锁串行化并复查防重，消除「同证件先后通过」竞态 */
async function saveApprovedWithIdGuard(redis: Redis, submission: KycSubmission): Promise<void> {
  const idNo = submission.extractedIdNo
  if (submission.status !== 'approved' || !idNo) {
    await saveKyc(redis, submission)
    return
  }
  const lockKey = idLockKey(idNo)
  const locked = await redis.set(lockKey, submission.userId, 'EX', 30, 'NX')
  if (!locked) throw new KycError('该证件正在被其他账号验证，请稍后再试', 409)
  try {
    const owner = await findKycByExtractedIdNo(redis, idNo, submission.userId)
    if (owner) throw new KycError('该证件已被其他账号用于实名认证', 409)
    await saveKyc(redis, submission)
  } finally {
    await redis.del(lockKey)
  }
}

export class KycError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'KycError'
    this.status = status
  }
}

/** 取款硬闸门：按当前后台配置判断是否已完成所需实名步骤 */
export async function isKycApproved(redis: Redis, env: Env, userId: string): Promise<boolean> {
  const kyc = await getKyc(redis, userId)
  if (!kyc) return false
  if (kyc.status === 'approved') return true
  // 人工驳回/撤销（无 rejectStep）永久拦截，需重新走流程
  if (kyc.status === 'rejected' && !kyc.rejectStep) return false
  const cfg = await getKycStepConfig(redis, env, userId)
  if (!kyc.phoneVerified) return false
  if (cfg.requireDocument && !kyc.docVerified) return false
  if (cfg.requireFace && !kyc.faceVerified) return false
  return true
}

export interface KycStepConfig {
  requireDocument: boolean
  requireFace: boolean
}

/**
 * 是否开启证件/人脸验证。系统级默认开启（后台可配置）；传 userId 时叠加该用户的个人覆盖。
 * 人脸需证件照比对，证件关闭时人脸强制关闭。
 */
export async function getKycStepConfig(
  redis: Redis,
  env: Env,
  userId?: string,
): Promise<KycStepConfig> {
  const [doc, face] = await Promise.all([
    getAdminSetting(env, 'kyc_require_document'),
    getAdminSetting(env, 'kyc_require_face'),
  ])
  let requireDocument = doc !== '0'
  let requireFace = face !== '0'
  if (userId) {
    const user = await getUser(redis, userId)
    if (user?.kycDocOverride != null) requireDocument = user.kycDocOverride
    if (user?.kycFaceOverride != null) requireFace = user.kycFaceOverride
  }
  return { requireDocument, requireFace: requireDocument && requireFace }
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
    // 撤销/驳回时清掉验证标志，让客户端与后台都不再显示"已认证"，用户需重新走流程
    docVerified: decision === 'approved',
    faceVerified: decision === 'approved',
    rejectReason: decision === 'rejected' ? note?.trim() || '人工审核未通过' : undefined,
    rejectStep: undefined,
    reviewedAt: now,
    reviewedBy: adminUsername,
  })
  return decision
}

const otpKey = (userId: string) => `kyc:otp:${userId}`
const resendKey = (userId: string) => `kyc:otp:sent:${userId}`
const otpLockKey = (userId: string) => `kyc:otp:lock:${userId}`
const kycFailureKey = (kind: 'doc' | 'face', userId: string) => `kyc:fail:${kind}:${userId}`
const kycFailureLockKey = (kind: 'doc' | 'face', userId: string) => `kyc:fail:lock:${kind}:${userId}`

interface OtpState {
  code: string
  phone: string
  attempts: number
}

async function enforceKycFailureLimit(
  redis: Redis,
  limit: number,
  kind: 'doc' | 'face',
  userId: string,
): Promise<void> {
  if (await redis.get(kycFailureLockKey(kind, userId))) {
    throw new KycError(kind === 'doc' ? 'kyc.errors.docFailureLimitReached' : 'kyc.errors.faceFailureLimitReached', 429)
  }
  const failed = Number(await redis.get(kycFailureKey(kind, userId)) ?? 0)
  if (failed >= limit) {
    await redis.set(kycFailureLockKey(kind, userId), '1', 'EX', KYC_FAILURE_LOCK_SECONDS)
    await redis.del(kycFailureKey(kind, userId))
    throw new KycError(kind === 'doc' ? 'kyc.errors.docFailureLimitReached' : 'kyc.errors.faceFailureLimitReached', 429)
  }
}

async function recordKycFailure(redis: Redis, limit: number, kind: 'doc' | 'face', userId: string): Promise<void> {
  const failed = await redis.incr(kycFailureKey(kind, userId))
  if (failed >= limit) {
    await redis.set(kycFailureLockKey(kind, userId), '1', 'EX', KYC_FAILURE_LOCK_SECONDS)
    await redis.del(kycFailureKey(kind, userId))
  }
}

async function clearKycFailure(redis: Redis, kind: 'doc' | 'face', userId: string): Promise<void> {
  await redis.del(kycFailureKey(kind, userId), kycFailureLockKey(kind, userId))
}

export async function sendKycOtp(
  redis: Redis,
  env: Env,
  userId: string,
  phoneRaw: string,
  ip?: string,
): Promise<{ phone: string; resendInSec: number }> {
  const phone = normalizePhonePH(phoneRaw)
  if (!phone) throw new KycError('kyc.errors.invalidPhone', 400)

  const phoneIdentity = (await listUserIdentities(redis, userId)).find((item) => item.provider === 'phone')
  if (phoneIdentity) {
    const bound = normalizePhonePH(phoneIdentity.identifier)
    if (bound && bound !== phone) {
      throw new KycError('kyc.errors.phoneUseRegistered', 400)
    }
  }

  const otherOwner = await findKycByVerifiedPhone(redis, phone, userId)
  if (otherOwner) throw new KycError('kyc.errors.phoneTaken', 409)
  const phoneAccountOwner = await getUserByPhoneAccount(redis, phone)
  if (phoneAccountOwner && phoneAccountOwner.id !== userId) {
    throw new KycError('kyc.errors.phoneTaken', 409)
  }

  if (await redis.get(resendKey(userId))) {
    throw new KycError('kyc.errors.rateLimited', 429)
  }
  if (await redis.get(otpLockKey(userId))) throw new KycError('kyc.errors.otpLocked', 429)
  try {
    await enforceSmsDailyLimit(redis, await getSmsDailyLimit(env), `user:${userId}`)
    if (ip) await enforceSmsDailyLimit(redis, await getSmsDailyIpLimit(env), `ip:${ip}`)
  } catch (e) {
    throw new KycError(e instanceof Error ? e.message : 'kyc.errors.smsDailyLimit', 429)
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
    throw new KycError(
      res.errCode ? `kyc.errors.smsFailedWithCode:${res.errCode}` : 'kyc.errors.smsFailed',
      502,
    )
  }
  await recordSmsSent(redis, `user:${userId}`)
  if (ip) await recordSmsSent(redis, `ip:${ip}`)
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
  env: Env,
  userId: string,
  code: string,
): Promise<{ phoneVerified: true; status: KycSubmission['status'] }> {
  if (await redis.get(otpLockKey(userId))) throw new KycError('kyc.errors.otpLocked', 429)
  const raw = await redis.get(otpKey(userId))
  if (!raw) throw new KycError('kyc.errors.otpExpired', 400)
  const state = JSON.parse(raw) as OtpState

  if (state.attempts >= MAX_VERIFY_ATTEMPTS) {
    state.attempts = 0
    const ttl = await redis.ttl(otpKey(userId))
    await redis.set(otpKey(userId), JSON.stringify(state), 'EX', ttl > 0 ? ttl : OTP_TTL_SEC)
    await redis.set(otpLockKey(userId), '1', 'EX', await getOtpLockSeconds(env))
    throw new KycError('kyc.errors.otpTooManyAttempts', 429)
  }
  if (code !== state.code) {
    state.attempts += 1
    const ttl = await redis.ttl(otpKey(userId))
    await redis.set(otpKey(userId), JSON.stringify(state), 'EX', ttl > 0 ? ttl : OTP_TTL_SEC)
    if (state.attempts >= MAX_VERIFY_ATTEMPTS) {
      state.attempts = 0
      await redis.set(otpKey(userId), JSON.stringify(state), 'EX', ttl > 0 ? ttl : OTP_TTL_SEC)
      await redis.set(otpLockKey(userId), '1', 'EX', await getOtpLockSeconds(env))
      throw new KycError('kyc.errors.otpTooManyAttempts', 429)
    }
    throw new KycError('kyc.errors.otpInvalid', 400)
  }

  await redis.del(otpKey(userId), otpLockKey(userId))
  const existing = await getKyc(redis, userId)
  const cfg = await getKycStepConfig(redis, env, userId)
  // 证件验证关闭 ⇒ 手机验证即完成实名（人脸已被强制关闭）
  const approvedByPhoneOnly = !cfg.requireDocument
  const now = nowIso()
  await saveKyc(redis, {
    ...(existing ?? blankSubmission(userId)),
    userId,
    phone: state.phone,
    phoneVerified: true,
    status: existing?.status === 'approved' || approvedByPhoneOnly ? 'approved' : 'pending',
    rejectReason: undefined,
    rejectStep: undefined,
    reviewedAt: approvedByPhoneOnly ? now : existing?.reviewedAt,
  })
  return { phoneVerified: true, status: approvedByPhoneOnly ? 'approved' : 'pending' }
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

/** 从证件出生日期字符串算周岁；无法解析返回 null */
function ageFromDob(dob: string | undefined): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age
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
  faceMatchWithId: number
  confidence: number
  reasons: string[]
}

function stripBase64(input: string): { data: string; mimeType: string } {
  const m = input.match(/^data:([^;]+);base64,(.*)$/)
  if (m) return { mimeType: m[1], data: m[2] }
  return { mimeType: 'image/jpeg', data: input }
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isGeminiRetryableError(err: unknown): boolean {
  if (err instanceof GoogleGenerativeAIFetchError) {
    const status = err.status
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(429|500|502|503|504)\b|high demand|overloaded|unavailable|rate limit|resource exhausted/i.test(msg)
}

function parseDurationToMs(raw: string): number | null {
  const s = raw.trim()
  const msMatch = s.match(/^(\d+(?:\.\d+)?)ms$/i)
  if (msMatch) return Math.ceil(Number(msMatch[1]))
  const secMatch = s.match(/^(\d+(?:\.\d+)?)s$/i)
  if (secMatch) return Math.ceil(Number(secMatch[1]) * 1000)
  return null
}

function parseRetryInfoDelayMs(details: Array<Record<string, unknown>>): number | null {
  for (const detail of details) {
    const type = typeof detail['@type'] === 'string' ? detail['@type'] : ''
    if (!type.includes('RetryInfo')) continue
    const retryDelay = detail.retryDelay
    if (typeof retryDelay === 'string') {
      const ms = parseDurationToMs(retryDelay)
      if (ms != null) return ms
    }
  }
  return null
}

/** 优先用 Google RetryInfo.retryDelay；无则短保底等待 */
function resolveGeminiRetryDelayMs(err: unknown): number {
  if (err instanceof GoogleGenerativeAIFetchError && err.errorDetails?.length) {
    const fromDetails = parseRetryInfoDelayMs(err.errorDetails as Array<Record<string, unknown>>)
    if (fromDetails != null) return Math.min(fromDetails, GEMINI_RETRY_DELAY_CAP_MS)
  }

  const msg = err instanceof Error ? err.message : String(err)
  const inlineRetry = msg.match(/"retryDelay"\s*:\s*"([^"]+)"/i)
  if (inlineRetry) {
    const ms = parseDurationToMs(inlineRetry[1])
    if (ms != null) return Math.min(ms, GEMINI_RETRY_DELAY_CAP_MS)
  }

  return GEMINI_RETRY_DELAY_FALLBACK_MS
}

/** lite 单次失败即切模型；2.5/1.5 按 Google RetryInfo 等待后重试 */
async function generateGeminiContent(
  env: Env,
  parts: GeminiPart[],
  parseFailMessage: string,
): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new KycError('KYC verification is not configured', 503)

  const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
  let lastErr: unknown

  for (let chainIdx = 0; chainIdx < GEMINI_MODEL_CHAIN.length; chainIdx++) {
    const { model: modelName, maxAttempts } = GEMINI_MODEL_CHAIN[chainIdx]
    const skipRetry = chainIdx === 0
    const model = ai.getGenerativeModel({ model: modelName })

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await model.generateContent(parts)
        const text = result.response.text().trim()
        if (attempt > 0 || modelName !== GEMINI_PRIMARY_MODEL) {
          console.warn(`[kyc] gemini ok model=${modelName} attempt=${attempt + 1}`)
        }
        return text
      } catch (err) {
        lastErr = err
        if (!isGeminiRetryableError(err)) {
          console.error('[kyc] gemini non-retryable:', err)
          throw new KycError(parseFailMessage, 502)
        }

        const hasMoreRetries = !skipRetry && attempt < maxAttempts - 1
        const delayMs = resolveGeminiRetryDelayMs(err)
        const action = hasMoreRetries ? 'retry' : 'fallback'
        console.warn(
          `[kyc] gemini ${action} model=${modelName} attempt=${attempt + 1}${hasMoreRetries ? ` wait=${delayMs}ms` : ''}:`,
          err instanceof Error ? err.message : err,
        )

        if (hasMoreRetries) {
          await sleep(delayMs)
          continue
        }
        break
      }
    }
  }

  console.error('[kyc] gemini all models failed:', lastErr)
  throw new KycError('认证服务繁忙，请稍后重试', 503)
}

async function runGeminiDocument(env: Env, fullName: string, idImage: string): Promise<GeminiDocVerdict> {
  const prompt = `You are a KYC document verification system. Analyze the provided ID document image only.

Accepted document types: passport, drivers_license, philid (Philippine National ID), umid, acr_icard (ACR I-Card / Alien Certificate of Registration Identity Card).
Use docType value exactly as listed (e.g. acr_icard for ACR I-Card).
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
  const text = await generateGeminiContent(
    env,
    [
      { text: prompt },
      { inlineData: { mimeType: idImg.mimeType, data: idImg.data } },
    ],
    '证件识别失败，请重试',
  )
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new KycError('证件识别失败，请重试', 502)
  return JSON.parse(jsonMatch[0]) as GeminiDocVerdict
}

async function runGeminiFace(
  env: Env,
  idImageBase64: string,
  selfieImage: string,
): Promise<GeminiFaceVerdict> {
  const prompt = `You are a KYC face-matching system. You receive:
1. An ID document photo (reference face on the document)
2. A single live selfie photo captured from the user's front camera

Verify:
- The selfie shows a real live person, not a photo of a photo / screen / printout
- The person in the selfie is the same person as the face on the ID document

Return ONLY a valid JSON object (no markdown) with exactly these keys:
{
  "isLivePerson": boolean,
  "faceMatchWithId": number,
  "confidence": number,
  "reasons": string[]
}
faceMatchWithId is a 0..1 similarity score between the selfie face and the ID photo face (1 = identical person).`

  const idImg = stripBase64(idImageBase64)
  const selfie = stripBase64(selfieImage)
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
    { text: 'ID document image:' },
    { inlineData: { mimeType: idImg.mimeType, data: idImg.data } },
    { text: 'Live selfie image:' },
    { inlineData: { mimeType: selfie.mimeType, data: selfie.data } },
  ]

  const text = await generateGeminiContent(env, parts, '人脸识别失败，请重试')
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
  const cfg = await getKycStepConfig(redis, env, userId)
  if (!cfg.requireDocument) {
    throw new KycError('证件验证已关闭', 400)
  }
  await enforceVerifyRateLimit(redis, env, userId, 'doc')
  const failureLimit = await getKycDocFailureLimit(env)
  await enforceKycFailureLimit(redis, failureLimit, 'doc', userId)

  if (!ACCEPTED_DOC_TYPES.includes(normalizeDocType(input.docType))) {
    throw new KycError('kyc.errors.unsupportedDocType', 400)
  }

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
  if (!verdict.isValidDocument) reasons.push('invalid_doc')
  if (!ACCEPTED_DOC_TYPES.includes(normalizeDocType(verdict.docType))) reasons.push('unsupported_doc_type')
  if (!verdict.nameMatches) reasons.push('name_mismatch')
  if (verdict.confidence < env.KYC_GEMINI_MIN_CONFIDENCE) reasons.push('low_confidence')
  // 年龄限制：证件出生日期可解析且不足 21 周岁 → 拒绝（OCR 无法解析出生日期时不拦截，避免误杀）
  const age = ageFromDob(verdict.dob)
  if (age != null && age < 21) reasons.push('underage')

  const docVerified = reasons.length === 0
  if (docVerified) {
    await clearKycFailure(redis, 'doc', userId)
  } else {
    await recordKycFailure(redis, failureLimit, 'doc', userId)
  }
  // 人脸验证关闭 ⇒ 证件通过即完成实名
  const approvedByDoc = docVerified && !cfg.requireFace
  const now = nowIso()
  const submission: KycSubmission = {
    ...existing,
    submissionId: userId,
    userId,
    status: docVerified ? (approvedByDoc ? 'approved' : 'pending') : 'rejected',
    fullName: input.fullName,
    docType: input.docType,
    verifyMode: 'document',
    docVerified,
    faceVerified: false,
    extractedIdNo: verdict.idNumber || undefined,
    dob: verdict.dob || existing?.dob || '',
    geminiConfidence: verdict.confidence,
    geminiResult: { document: verdict },
    docImageKey,
    rejectReason: docVerified ? undefined : reasons.join(';'),
    rejectStep: docVerified ? undefined : 'document',
    submittedAt: now,
    docSubmittedAt: now,
    livenessFrames: undefined,
    selfieImageKey: undefined,
    faceSubmittedAt: undefined,
    reviewedAt: approvedByDoc ? now : undefined,
    reviewedBy: undefined,
    badgeIgnored: false,
  }
  await saveApprovedWithIdGuard(redis, submission)
  broadcastBadges(env).catch(() => {})
  // 证件通过即完成实名时，把证件生日同步进用户生日字段（生日只来自 KYC，不接受手输）
  if (submission.status === 'approved') {
    ensureBirthdayFromKyc(env, userId).catch((e) => console.error('[kyc] sync birthday failed:', e))
  }

  // 记录历史提交（MySQL），管理后台可查看所有提交记录
  if (isMysqlEnabled(env)) {
    getMysqlPool(env).execute(
      `INSERT INTO bg_kyc_doc_log (user_id, full_name, doc_type, doc_image_key, gemini_confidence, doc_verified, reject_reason)
       VALUES (?,?,?,?,?,?,?)`,
      [userId, input.fullName, input.docType, docImageKey ?? null, verdict.confidence, docVerified ? 1 : 0, submission.rejectReason ?? null],
    ).catch((e) => console.error('[kyc] doc log insert failed:', e))
  }

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
  selfieImage: string,
): Promise<{ faceVerified: boolean; status: KycSubmission['status']; rejectReason?: string; rejectStep?: string }> {
  const existing = await getKyc(redis, userId)
  if (!existing?.phoneVerified) throw new KycError('请先完成手机验证', 400)
  if (!(await getKycStepConfig(redis, env, userId)).requireFace) {
    throw new KycError('人脸验证已关闭', 400)
  }
  if (!existing.docVerified || !existing.docImageKey) {
    throw new KycError('请先完成证件验证', 400)
  }

  await enforceVerifyRateLimit(redis, env, userId, 'face')
  const failureLimit = await getKycFaceFailureLimit(env)
  await enforceKycFailureLimit(redis, failureLimit, 'face', userId)

  const storage = getStorageProvider(env)
  const docFile = await storage.get(existing.docImageKey)
  if (!docFile) throw new KycError('证件图片不存在，请重新提交证件', 400)

  const idImageBase64 = `data:${docFile.mimeType};base64,${docFile.data.toString('base64')}`
  const verdict = await runGeminiFace(env, idImageBase64, selfieImage)

  const ts = Date.now()
  const livenessFrames: LivenessFrameMeta[] = []
  try {
    const img = stripBase64(selfieImage)
    const key = await storage.put(`${userId}/${ts}_selfie.jpg`, Buffer.from(img.data, 'base64'), img.mimeType)
    livenessFrames.push({ action: 'neutral', key, capturedAt: nowIso() })
  } catch (e) {
    console.error('[kyc] store selfie image failed:', e)
  }

  const threshold = await getKycFaceMatchThreshold(env)
  const reasons: string[] = []
  if (!verdict.isLivePerson) reasons.push('no_live_person')
  if ((verdict.faceMatchWithId ?? 0) < threshold) reasons.push('face_id_mismatch')
  if (verdict.confidence < env.KYC_GEMINI_MIN_CONFIDENCE) reasons.push('low_liveness_confidence')

  const faceVerified = reasons.length === 0
  if (faceVerified) {
    await clearKycFailure(redis, 'face', userId)
  } else {
    await recordKycFailure(redis, failureLimit, 'face', userId)
  }
  const now = nowIso()
  const submission: KycSubmission = {
    ...existing,
    status: faceVerified ? 'approved' : 'rejected',
    verifyMode: 'face',
    faceVerified,
    geminiResult: { ...(existing.geminiResult ?? {}), face: { ...verdict, threshold } },
    geminiConfidence: verdict.confidence,
    livenessFrames,
    selfieImageKey: livenessFrames[0]?.key,
    rejectReason: faceVerified ? undefined : reasons.join(';'),
    rejectStep: faceVerified ? undefined : 'face',
    faceSubmittedAt: now,
    reviewedAt: faceVerified ? now : undefined,
    badgeIgnored: false,
  }

  await saveApprovedWithIdGuard(redis, submission)
  broadcastBadges(env).catch(() => {})
  if (submission.status === 'approved') {
    ensureBirthdayFromKyc(env, userId).catch((e) => console.error('[kyc] sync birthday failed:', e))
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
    const faceResult = await submitKycFace(redis, env, userId, input.selfieImage)
    return { status: faceResult.status, rejectReason: faceResult.rejectReason }
  }
  return { status: docResult.status, rejectReason: docResult.rejectReason }
}
