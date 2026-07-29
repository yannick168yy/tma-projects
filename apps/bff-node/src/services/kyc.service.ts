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
import { notifyKycRejected } from './admin-notify.js'
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
const KYC_DOCUMENT_SYNC_TIMEOUT_MS = 18_000
const OTP_TTL_SEC = 300
const RESEND_INTERVAL_SEC = 60
const MAX_VERIFY_ATTEMPTS = 3
const KYC_FAILURE_LOCK_SECONDS = 180
const KYC_NOTIFY_FAILURE_COUNT = 3
const ACCEPTED_DOC_TYPES = ['passport', 'drivers_license', 'philid', 'umid', 'acr_icard']
const NAME_SUFFIX_TOKENS = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V'])
const RETRYABLE_DOC_REASONS = new Set(['invalid_doc', 'missing_id_number', 'low_confidence'])
const HARD_REJECT_DOC_REASONS = new Set(['unsupported_doc_type'])
const WEAK_NAME_TOKENS = new Set([
  'DA',
  'DAS',
  'DE',
  'DEL',
  'DELA',
  'DI',
  'DOS',
  'LA',
  'LAS',
  'LOS',
  'VAN',
  'VON',
])

function normalizeDocType(raw: string): string {
  const s = raw.toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (s === 'acr_i_card' || s === 'i_card' || s === 'icard') return 'acr_icard'
  return s
}

/** 证件号归一化：去掉分隔符只留字母数字并大写，保证跨次 OCR 输出格式差异不影响查重 */
function normalizeIdNo(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

type KycNameMatchReason = 'exact' | 'reordered' | 'middle_initial' | 'core_tokens' | 'mismatch'

interface KycNameCheck {
  matched: boolean
  reason: KycNameMatchReason
  inputTokens: string[]
  documentTokens: string[]
}

function kycNameTokens(raw: string): string[] {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .filter((token) => token && !NAME_SUFFIX_TOKENS.has(token) && !WEAK_NAME_TOKENS.has(token))
}

function nameTokenMatches(a: string, b: string): boolean {
  return a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))
}

function allNameTokensMatch(from: string[], to: string[]): { matched: boolean; usedInitial: boolean } {
  const used = new Set<number>()
  let usedInitial = false
  for (const token of from) {
    const idx = to.findIndex((candidate, i) => !used.has(i) && nameTokenMatches(token, candidate))
    if (idx < 0) return { matched: false, usedInitial: false }
    used.add(idx)
    if (token !== to[idx]) usedInitial = true
  }
  return { matched: true, usedInitial }
}

function endpointTokensMatch(shorter: string[], longer: string[]): boolean {
  if (shorter.length < 2 || longer.length < 2) return false
  return (
    nameTokenMatches(shorter[0], longer[0])
    && nameTokenMatches(shorter[shorter.length - 1], longer[longer.length - 1])
  ) || (
    nameTokenMatches(shorter[0], longer[longer.length - 1])
    && nameTokenMatches(shorter[shorter.length - 1], longer[0])
  )
}

export function compareKycNames(inputName: string, documentName: string): KycNameCheck {
  const inputTokens = kycNameTokens(inputName)
  const documentTokens = kycNameTokens(documentName)
  if (inputTokens.length < 2 || documentTokens.length < 2) {
    const exactSingleName = inputTokens.length === 1
      && documentTokens.length === 1
      && inputTokens[0] === documentTokens[0]
    return { matched: exactSingleName, reason: exactSingleName ? 'exact' : 'mismatch', inputTokens, documentTokens }
  }

  const sameOrder = inputTokens.length === documentTokens.length
    && inputTokens.every((token, i) => nameTokenMatches(token, documentTokens[i]))
  if (sameOrder) {
    const usedInitial = inputTokens.some((token, i) => token !== documentTokens[i])
    return { matched: true, reason: usedInitial ? 'middle_initial' : 'exact', inputTokens, documentTokens }
  }

  if (inputTokens.length === documentTokens.length) {
    const result = allNameTokensMatch(inputTokens, documentTokens)
    if (result.matched) {
      return { matched: true, reason: result.usedInitial ? 'middle_initial' : 'reordered', inputTokens, documentTokens }
    }
  }

  const shorter = inputTokens.length < documentTokens.length ? inputTokens : documentTokens
  const longer = inputTokens.length < documentTokens.length ? documentTokens : inputTokens
  const subset = allNameTokensMatch(shorter, longer)
  if (subset.matched && endpointTokensMatch(shorter, longer)) {
    return { matched: true, reason: subset.usedInitial ? 'middle_initial' : 'core_tokens', inputTokens, documentTokens }
  }

  return { matched: false, reason: 'mismatch', inputTokens, documentTokens }
}
const VERIFY_RL_WINDOW_SEC = 86400

async function getVerifiedPhoneIdentity(redis: Redis, userId: string): Promise<string | null> {
  const phoneIdentity = (await listUserIdentities(redis, userId)).find((item) => item.provider === 'phone' && item.verifiedAt)
  return phoneIdentity ? normalizePhonePH(phoneIdentity.identifier) : null
}

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
    throw new KycError('kyc.errors.verifyTooFrequent', 429)
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
  if (!locked) throw new KycError('kyc.errors.docVerifyBusy', 409)
  try {
    const owner = await findKycByExtractedIdNo(redis, idNo, submission.userId)
    if (owner) throw new KycError('kyc.errors.docAlreadyUsed', 409)
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
  if (kyc?.status === 'approved') return true
  const cfg = await getKycStepConfig(redis, env, userId)
  // 手机与证件都关闭 = 实名流程整体关闭，不设闸门
  if (!cfg.requirePhone && !cfg.requireDocument) return true
  if (!kyc) return false
  // 人工驳回/撤销（无 rejectStep）永久拦截，需重新走流程
  if (kyc.status === 'rejected' && !kyc.rejectStep) return false
  if (cfg.requirePhone && !kyc.phoneVerified) return false
  if (cfg.requireDocument && !kyc.docVerified) return false
  if (cfg.requireFace && !kyc.faceVerified) return false
  return true
}

export interface KycStepConfig {
  requirePhone: boolean
  requireDocument: boolean
  requireFace: boolean
}

/**
 * 是否开启手机/证件/人脸验证。系统级默认开启（后台可配置）；传 userId 时叠加该用户的个人覆盖（仅证件/人脸）。
 * 人脸需证件照比对，证件关闭时人脸强制关闭。
 */
export async function getKycStepConfig(
  redis: Redis,
  env: Env,
  userId?: string,
): Promise<KycStepConfig> {
  const [phone, doc, face] = await Promise.all([
    getAdminSetting(env, 'kyc_require_phone'),
    getAdminSetting(env, 'kyc_require_document'),
    getAdminSetting(env, 'kyc_require_face'),
  ])
  const requirePhone = phone !== '0'
  let requireDocument = doc !== '0'
  let requireFace = face !== '0'
  if (userId) {
    const user = await getUser(redis, userId)
    if (user?.kycDocOverride != null) requireDocument = user.kycDocOverride
    if (user?.kycFaceOverride != null) requireFace = user.kycFaceOverride
  }
  return { requirePhone, requireDocument, requireFace: requireDocument && requireFace }
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
    /** 是否真的提交过证件：区分"手机验证后的 pending"与"证件已交待审核" */
    docSubmittedAt: kyc?.docSubmittedAt ?? null,
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

async function recordKycFailure(redis: Redis, limit: number, kind: 'doc' | 'face', userId: string): Promise<number> {
  const failed = await redis.incr(kycFailureKey(kind, userId))
  if (failed >= limit) {
    await redis.set(kycFailureLockKey(kind, userId), '1', 'EX', KYC_FAILURE_LOCK_SECONDS)
    await redis.del(kycFailureKey(kind, userId))
  }
  return failed
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
  if (!(await getKycStepConfig(redis, env, userId)).requirePhone) {
    throw new KycError('手机验证已关闭', 400)
  }
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

/**
 * OTP 关闭时的直接绑定：不发短信，仅校验号码格式与占用后落库。
 * 「手机验证」开关只决定是否需要短信 OTP，绑定手机号本身始终必须；开关开启时禁止走此通道（防绕过 OTP）。
 */
export async function bindKycPhone(
  redis: Redis,
  env: Env,
  userId: string,
  phoneRaw: string,
): Promise<{ phoneVerified: true; status: KycSubmission['status'] }> {
  const cfg = await getKycStepConfig(redis, env, userId)
  if (cfg.requirePhone) throw new KycError('kyc.errors.otpRequired', 400)
  const phone = normalizePhonePH(phoneRaw)
  if (!phone) throw new KycError('kyc.errors.invalidPhone', 400)

  const phoneIdentity = (await listUserIdentities(redis, userId)).find((item) => item.provider === 'phone')
  if (phoneIdentity) {
    const bound = normalizePhonePH(phoneIdentity.identifier)
    if (bound && bound !== phone) throw new KycError('kyc.errors.phoneUseRegistered', 400)
  }
  const otherOwner = await findKycByVerifiedPhone(redis, phone, userId)
  if (otherOwner) throw new KycError('kyc.errors.phoneTaken', 409)
  const phoneAccountOwner = await getUserByPhoneAccount(redis, phone)
  if (phoneAccountOwner && phoneAccountOwner.id !== userId) throw new KycError('kyc.errors.phoneTaken', 409)

  const existing = await getKyc(redis, userId)
  const approvedByPhoneOnly = !cfg.requireDocument
  const now = nowIso()
  await saveKyc(redis, {
    ...(existing ?? blankSubmission(userId)),
    userId,
    phone,
    phoneVerified: true,
    status: existing?.status === 'approved' || approvedByPhoneOnly ? 'approved' : 'pending',
    rejectReason: undefined,
    rejectStep: undefined,
    reviewedAt: approvedByPhoneOnly ? now : existing?.reviewedAt,
  })
  return { phoneVerified: true, status: approvedByPhoneOnly ? 'approved' : 'pending' }
}

export async function verifyKycOtp(
  redis: Redis,
  env: Env,
  userId: string,
  code: string,
): Promise<{ phoneVerified: true; status: KycSubmission['status']; phone: string }> {
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
  return { phoneVerified: true, status: approvedByPhoneOnly ? 'approved' : 'pending', phone: state.phone }
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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new KycError(message, 502)), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
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
  const claimedNameLine = fullName.trim()
    ? `The user claims their full name is: "${fullName.trim()}".`
    : 'No user-entered name is provided; extract the full legal name from the document.'
  const prompt = `You are a KYC document verification system. Analyze the provided ID document image only.

Accepted document types: passport, drivers_license, philid (Philippine National ID), umid, acr_icard (ACR I-Card / Alien Certificate of Registration Identity Card).
Use docType value exactly as listed (e.g. acr_icard for ACR I-Card).
${claimedNameLine}

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
}
idNumber must be the document's ID/passport number exactly as printed; use an empty string if it is not clearly readable. Never guess or fabricate it.`

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
  const cfg = await getKycStepConfig(redis, env, userId)
  const verifiedPhoneIdentity = cfg.requirePhone && !existing?.phoneVerified
    ? await getVerifiedPhoneIdentity(redis, userId)
    : null
  if (cfg.requirePhone && !existing?.phoneVerified && !verifiedPhoneIdentity) {
    throw new KycError('请先完成手机验证', 400)
  }
  if (verifiedPhoneIdentity) {
    const otherOwner = await findKycByVerifiedPhone(redis, verifiedPhoneIdentity, userId)
    if (otherOwner) throw new KycError('kyc.errors.phoneTaken', 409)
  }
  if (!cfg.requireDocument) {
    throw new KycError('证件验证已关闭', 400)
  }
  await enforceVerifyRateLimit(redis, env, userId, 'doc')
  const failureLimit = await getKycDocFailureLimit(env)
  await enforceKycFailureLimit(redis, failureLimit, 'doc', userId)

  if (!ACCEPTED_DOC_TYPES.includes(normalizeDocType(input.docType))) {
    throw new KycError('kyc.errors.unsupportedDocType', 400)
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

  let verdict: GeminiDocVerdict
  try {
    verdict = await withTimeout(
      runGeminiDocument(env, input.fullName, input.idImage),
      KYC_DOCUMENT_SYNC_TIMEOUT_MS,
      '证件识别超时，已转人工审核',
    )
  } catch (e) {
    const now = nowIso()
    const reason = 'recognition_error'
    const submission: KycSubmission = {
      ...(existing ?? blankSubmission(userId)),
      submissionId: userId,
      userId,
      status: 'pending',
      fullName: input.fullName.trim(),
      phone: existing?.phone ?? verifiedPhoneIdentity ?? undefined,
      phoneVerified: existing?.phoneVerified || Boolean(verifiedPhoneIdentity),
      docType: input.docType,
      verifyMode: 'document',
      docVerified: false,
      faceVerified: false,
      geminiResult: { document: { error: e instanceof Error ? e.message : String(e) } },
      docImageKey,
      rejectReason: reason,
      rejectStep: 'document',
      submittedAt: now,
      docSubmittedAt: now,
      livenessFrames: undefined,
      selfieImageKey: undefined,
      faceSubmittedAt: undefined,
      reviewedAt: undefined,
      reviewedBy: undefined,
      badgeIgnored: false,
    }
    await saveKyc(redis, submission)
    broadcastBadges(env).catch(() => {})
    if (isMysqlEnabled(env)) {
      getMysqlPool(env).execute(
        `INSERT INTO bg_kyc_doc_log (user_id, full_name, doc_type, doc_image_key, gemini_confidence, doc_verified, reject_reason)
         VALUES (?,?,?,?,?,?,?)`,
        [userId, submission.fullName, input.docType, docImageKey ?? null, null, 0, reason],
      ).catch((err) => console.error('[kyc] doc log insert failed:', err))
    }
    return { docVerified: false, status: 'pending', rejectReason: reason, rejectStep: 'document' }
  }

  // 证件号归一化(去分隔符+大写)后作为唯一键;提得出必查重
  const idNo = normalizeIdNo(verdict.idNumber)
  if (idNo) {
    const owner = await findKycByExtractedIdNo(redis, idNo, userId)
    if (owner) throw new KycError('kyc.errors.docAlreadyUsed', 409)
  }

  const reasons: string[] = []
  const claimedFullName = input.fullName.trim()
  const extractedFullName = verdict.fullName.trim()
  const nameCheck = claimedFullName ? compareKycNames(claimedFullName, extractedFullName) : undefined
  if (!verdict.isValidDocument) reasons.push('invalid_doc')
  if (!ACCEPTED_DOC_TYPES.includes(normalizeDocType(verdict.docType))) reasons.push('unsupported_doc_type')
  // 证件号是防多账号复用的唯一键，提不出一律拒绝重拍
  if (!idNo) reasons.push('missing_id_number')
  if (!extractedFullName) reasons.push('invalid_doc')
  if (verdict.confidence < env.KYC_GEMINI_MIN_CONFIDENCE) reasons.push('low_confidence')

  const docVerified = reasons.length === 0
  let failedCount = 0
  if (docVerified) {
    await clearKycFailure(redis, 'doc', userId)
  } else {
    failedCount = await recordKycFailure(redis, failureLimit, 'doc', userId)
  }
  // 人脸验证关闭 ⇒ 证件通过即完成实名
  const approvedByDoc = docVerified && !cfg.requireFace
  const hardRejected = reasons.some((reason) => HARD_REJECT_DOC_REASONS.has(reason))
  const retryableOnly = reasons.length > 0 && reasons.every((reason) => RETRYABLE_DOC_REASONS.has(reason))
  const manualReview = !docVerified && !hardRejected && (!retryableOnly || failedCount >= failureLimit)
  const now = nowIso()
  if (!docVerified && retryableOnly && !manualReview) {
    const rejectReason = reasons.join(';')
    if (isMysqlEnabled(env)) {
      getMysqlPool(env).execute(
        `INSERT INTO bg_kyc_doc_log (user_id, full_name, doc_type, doc_image_key, gemini_confidence, doc_verified, reject_reason)
         VALUES (?,?,?,?,?,?,?)`,
        [userId, extractedFullName || claimedFullName, input.docType, docImageKey ?? null, verdict.confidence, 0, rejectReason],
      ).catch((e) => console.error('[kyc] doc log insert failed:', e))
    }
    return {
      docVerified: false,
      status: 'rejected',
      rejectReason,
      rejectStep: 'document',
    }
  }
  const submission: KycSubmission = {
    ...(existing ?? blankSubmission(userId)),
    submissionId: userId,
    userId,
    status: docVerified ? (approvedByDoc ? 'approved' : 'pending') : hardRejected ? 'rejected' : 'pending',
    fullName: extractedFullName || claimedFullName,
    phone: existing?.phone ?? verifiedPhoneIdentity ?? undefined,
    phoneVerified: existing?.phoneVerified || Boolean(verifiedPhoneIdentity),
    docType: input.docType,
    verifyMode: 'document',
    docVerified,
    faceVerified: false,
    extractedIdNo: idNo || undefined,
    dob: verdict.dob || existing?.dob || '',
    geminiConfidence: verdict.confidence,
    geminiResult: { document: { ...verdict, nameCheck } },
    docImageKey,
    rejectReason: docVerified ? undefined : reasons.join(';'),
    rejectStep: docVerified ? undefined : 'document',
    submittedAt: now,
    docSubmittedAt: now,
    livenessFrames: undefined,
    selfieImageKey: undefined,
    faceSubmittedAt: undefined,
    reviewedAt: approvedByDoc || hardRejected ? now : undefined,
    reviewedBy: undefined,
    badgeIgnored: false,
  }
  await saveApprovedWithIdGuard(redis, submission)
  broadcastBadges(env).catch(() => {})
  if (!docVerified && failedCount >= KYC_NOTIFY_FAILURE_COUNT) {
    notifyKycRejected(env, { userId, fullName: submission.fullName, stage: 'document', reasons }).catch(() => {})
  }
  // 证件通过即完成实名时，把证件生日同步进用户生日字段（生日只来自 KYC，不接受手输）
  if (submission.status === 'approved') {
    ensureBirthdayFromKyc(env, userId).catch((e) => console.error('[kyc] sync birthday failed:', e))
  }

  // 记录历史提交（MySQL），管理后台可查看所有提交记录
  if (isMysqlEnabled(env)) {
    getMysqlPool(env).execute(
      `INSERT INTO bg_kyc_doc_log (user_id, full_name, doc_type, doc_image_key, gemini_confidence, doc_verified, reject_reason)
       VALUES (?,?,?,?,?,?,?)`,
      [userId, submission.fullName, input.docType, docImageKey ?? null, verdict.confidence, docVerified ? 1 : 0, submission.rejectReason ?? null],
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
  const cfg = await getKycStepConfig(redis, env, userId)
  if (cfg.requirePhone && !existing?.phoneVerified) throw new KycError('请先完成手机验证', 400)
  if (!cfg.requireFace) {
    throw new KycError('人脸验证已关闭', 400)
  }
  if (!existing?.docVerified || !existing.docImageKey) {
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
  let failedCount = 0
  if (faceVerified) {
    await clearKycFailure(redis, 'face', userId)
  } else {
    failedCount = await recordKycFailure(redis, failureLimit, 'face', userId)
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
  if (submission.status === 'rejected' && failedCount >= KYC_NOTIFY_FAILURE_COUNT) {
    notifyKycRejected(env, { userId, fullName: existing.fullName, stage: 'face', reasons }).catch(() => {})
  }
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
