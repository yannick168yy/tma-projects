import { validate, parse } from '@tma.js/init-data-node'
import { randomInt } from 'node:crypto'
import type { Env } from '../config/env.js'
import type { Redis } from 'ioredis'
import {
  bindIdentity,
  createDevUser,
  createUserFromGoogle,
  createUserFromPassword,
  createUserFromTelegram,
  createUserFromTelegramOidc,
  deleteSession,
  findKycByVerifiedPhone,
  getSession,
  getUser,
  getUserIdentity,
  getUserByEmail,
  getUserByGoogleSub,
  getUserByTelegramOidcSub,
  getUserByInviteCode,
  getUserByPhoneAccount,
  getUserByTelegramId,
  getUserByUsername,
  listUserIdentities,
  saveSession,
  saveUser,
} from './store/index.js'
import { randomToken } from '../utils/id.js'
import { normalizePhonePH } from '../utils/phone.js'
import { verifyTelegramWidget } from '../utils/telegramWidget.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import type { UserRecord } from '../types/domain.js'
import { getSmsProvider, isSmsTestModeEnabled } from './sms/index.js'
import { appendSmsSendLog } from './sms/send-log.js'
import { exchangeGoogleCode } from './google.service.js'
import { exchangeTelegramOidcCode } from './telegramOidc.service.js'
import { toPublicUser } from './userPresentation.js'
import { lookupRegion } from './geo.service.js'
import { findEntryBotAgent, attributeAgentByBot } from './agent.service.js'

export type PasswordMethod = 'phone' | 'account'

const OTP_TTL_SEC = 300
const RESEND_INTERVAL_SEC = 60
const MAX_VERIFY_ATTEMPTS = 5

export class AuthError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

function displayNameFromInit(data: ReturnType<typeof parse>): string {
  const u = data.user
  if (!u) return 'Telegram User'
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Telegram User'
}

export async function loginWithInitData(
  redis: Redis,
  env: Env,
  initDataRaw: string,
  startParam?: string,
  ip?: string,
): Promise<{
  token: string
  expiresIn: number
  user: UserRecord
  isNewUser: boolean
  trialRedPacketEligible: boolean
}> {
  let tgUserId: number
  let displayName: string
  let avatarUrl: string | undefined

  if (!initDataRaw && env.BFF_DEV_SKIP_TELEGRAM_AUTH && env.NODE_ENV !== 'production') {
    const dev = await createDevUser(redis)
    return issueSession(redis, env, dev.user, dev.isNewUser)
  }

  if (!initDataRaw) throw new AuthError('Missing Telegram initData')

  // 先用主 bot token 验签；失败则尝试各代理 bot token，识别入口 bot 以归因。
  let entryBotAgentId: string | null = null
  try {
    validate(initDataRaw, env.TELEGRAM_BOT_TOKEN, { expiresIn: 86400 })
  } catch {
    entryBotAgentId = await findEntryBotAgent(env, initDataRaw)
    if (!entryBotAgentId) throw new AuthError('Invalid or expired Telegram initData')
  }

  const parsed = parse(initDataRaw)
  if (!parsed.user?.id) throw new AuthError('Telegram user missing in initData')

  tgUserId = parsed.user.id
  displayName = displayNameFromInit(parsed)
  avatarUrl = parsed.user.photoUrl

  let referredBy: string | undefined
  const refCode = startParam?.replace(/^ref_/, '') ?? parsed.startParam?.replace(/^ref_/, '')
  if (refCode) {
    const inviter = await getUserByInviteCode(redis, refCode.toUpperCase())
    if (inviter) referredBy = inviter.id
  }

  const region = ip ? lookupRegion(ip) : undefined
  const { user, isNewUser } = await createUserFromTelegram(redis, {
    telegramUserId: tgUserId,
    displayName,
    avatarUrl,
    telegramUsername: parsed.user.username,
    referredBy,
    registerIp: ip,
    registerRegion: region,
  })

  // Telegram 登录不受账号禁用状态影响（禁用仅屏蔽 Google 登录）
  // banned 状态除外：完全封禁
  if (user.status === 'banned') {
    throw new AuthError('Account has been permanently banned. Please contact support.')
  }

  // 经代理 bot 进入的新用户：归因到该代理（非致命）
  if (isNewUser && entryBotAgentId) {
    await attributeAgentByBot(env, user.id, entryBotAgentId).catch(() => {})
  }

  return issueSession(redis, env, user, isNewUser)
}

export async function loginWithGoogleCode(
  redis: Redis,
  env: Env,
  code: string,
  redirectUri: string,
  ip?: string,
  referralCode?: string,
): Promise<{
  token: string
  expiresIn: number
  user: UserRecord
  isNewUser: boolean
  trialRedPacketEligible: boolean
}> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AuthError('Google login is not configured')
  }

  const expectedRedirect = env.GOOGLE_REDIRECT_URI
  if (redirectUri !== expectedRedirect) {
    throw new AuthError('Invalid redirect URI')
  }

  try {
    const profile = await exchangeGoogleCode(env, code, redirectUri)

    let referredBy: string | undefined
    if (referralCode) {
      const inviter = await getUserByInviteCode(redis, referralCode.toUpperCase())
      if (inviter) referredBy = inviter.id
    }

    const region = ip ? lookupRegion(ip) : undefined
    const { user, isNewUser } = await createUserFromGoogle(redis, {
      googleSub: profile.sub,
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.picture,
      referredBy,
      registerIp: ip,
      registerRegion: region,
    })
    // Google 登录：frozen 和 banned 均拦截
    if (user.status === 'frozen' || user.status === 'banned') {
      throw new AuthError('Account has been disabled. Please contact support.')
    }
    return issueSession(redis, env, user, isNewUser)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Google login failed'
    throw new AuthError(message)
  }
}

const USERNAME_RE = /^[A-Za-z0-9_]{4,20}$/

function normalizeIdentifier(method: PasswordMethod, identifier: string): string {
  const id = identifier.trim()
  if (method === 'phone') {
    const e164 = normalizePhonePH(id)
    if (!e164) throw new AuthError('Invalid phone number', 400)
    return e164
  }
  if (!USERNAME_RE.test(id)) {
    throw new AuthError('Username must be 4-20 letters, digits or underscore', 400)
  }
  return id
}

const forgotOtpKey = (phone: string) => `auth:forgot:otp:${phone}`
const forgotResendKey = (phone: string) => `auth:forgot:sent:${phone}`

interface ForgotOtpState {
  code: string
  attempts: number
}

export async function registerWithPassword(
  redis: Redis,
  env: Env,
  input: { method: PasswordMethod; identifier: string; password: string; referralCode?: string },
  ip?: string,
): Promise<{
  token: string
  expiresIn: number
  user: UserRecord
  isNewUser: boolean
  trialRedPacketEligible: boolean
}> {
  if (!input.password || input.password.length < 8) {
    throw new AuthError('Password must be at least 8 characters', 400)
  }
  const identifier = normalizeIdentifier(input.method, input.identifier)

  const existing = input.method === 'phone'
    ? await getUserByPhoneAccount(redis, identifier)
    : await getUserByUsername(redis, identifier)
  if (existing) {
    throw new AuthError(input.method === 'phone' ? 'Phone already registered' : 'Username already taken', 409)
  }
  // 手机全局互斥：注册手机不能是他号已验证的 KYC 手机
  if (input.method === 'phone' && (await findKycByVerifiedPhone(redis, identifier, ''))) {
    throw new AuthError('该手机号已被其他账号使用', 409)
  }

  let referredBy: string | undefined
  if (input.referralCode) {
    const inviter = await getUserByInviteCode(redis, input.referralCode.toUpperCase())
    if (inviter) referredBy = inviter.id
  }

  const passwordHash = await hashPassword(input.password)
  const region = ip ? lookupRegion(ip) : undefined
  const { user, isNewUser } = await createUserFromPassword(redis, {
    identifierType: input.method,
    identifier,
    passwordHash,
    displayName: input.method === 'phone' ? identifier : input.identifier.trim(),
    referredBy,
    registerIp: ip,
    registerRegion: region,
  })
  return issueSession(redis, env, user, isNewUser)
}

export async function loginWithPassword(
  redis: Redis,
  env: Env,
  input: { method: PasswordMethod; identifier: string; password: string },
): Promise<{
  token: string
  expiresIn: number
  user: UserRecord
  isNewUser: boolean
  trialRedPacketEligible: boolean
}> {
  const identifier = normalizeIdentifier(input.method, input.identifier)
  const identity = await getUserIdentity(redis, input.method, identifier)
  const user = identity ? await getUser(redis, identity.userId) : null

  if (!user || !identity?.credentialHash || !(await verifyPassword(input.password, identity.credentialHash))) {
    throw new AuthError('Invalid credentials')
  }
  if (user.status === 'banned' || user.status === 'frozen') {
    throw new AuthError('Account has been disabled. Please contact support.')
  }
  return issueSession(redis, env, user, false)
}

export async function sendForgotPasswordOtp(
  redis: Redis,
  env: Env,
  phoneRaw: string,
): Promise<{ phone: string; resendInSec: number }> {
  const phone = normalizeIdentifier('phone', phoneRaw)
  const identity = await getUserIdentity(redis, 'phone', phone)
  const user = identity ? await getUser(redis, identity.userId) : null
  if (!user || !identity?.credentialHash) {
    throw new AuthError('auth.errors.phoneAccountNotFound', 404)
  }
  if (await redis.get(forgotResendKey(phone))) {
    throw new AuthError('kyc.errors.rateLimited', 429)
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const state: ForgotOtpState = { code, attempts: 0 }
  await redis.set(forgotOtpKey(phone), JSON.stringify(state), 'EX', OTP_TTL_SEC)
  await redis.set(forgotResendKey(phone), '1', 'EX', RESEND_INTERVAL_SEC)

  const text = `Your BetoGo password reset code is ${code}. Valid for 5 minutes. Do not share it.`
  const mocked = await isSmsTestModeEnabled(redis, env)
  const res = await (await getSmsProvider(env, redis)).sendSms(phone, text)
  if (!res.ok) {
    await redis.del(forgotOtpKey(phone), forgotResendKey(phone))
    throw new AuthError(
      res.errCode ? `kyc.errors.smsFailedWithCode:${res.errCode}` : 'kyc.errors.smsFailed',
      502,
    )
  }
  await appendSmsSendLog(redis, {
    scene: 'auth_forgot_password',
    userId: user.id,
    phone,
    code,
    text,
    mocked,
  })
  return { phone, resendInSec: RESEND_INTERVAL_SEC }
}

export async function resetForgotPassword(
  redis: Redis,
  phoneRaw: string,
  code: string,
  password: string,
): Promise<void> {
  if (!password || password.length < 8) {
    throw new AuthError('Password must be at least 8 characters', 400)
  }
  const phone = normalizeIdentifier('phone', phoneRaw)
  const identity = await getUserIdentity(redis, 'phone', phone)
  const user = identity ? await getUser(redis, identity.userId) : null
  if (!user || !identity?.credentialHash) {
    throw new AuthError('auth.errors.phoneAccountNotFound', 404)
  }

  const raw = await redis.get(forgotOtpKey(phone))
  if (!raw) throw new AuthError('kyc.errors.otpExpired', 400)
  const state = JSON.parse(raw) as ForgotOtpState
  if (state.attempts >= MAX_VERIFY_ATTEMPTS) {
    await redis.del(forgotOtpKey(phone))
    throw new AuthError('kyc.errors.otpTooManyAttempts', 429)
  }
  if (code !== state.code) {
    state.attempts += 1
    const ttl = await redis.ttl(forgotOtpKey(phone))
    await redis.set(forgotOtpKey(phone), JSON.stringify(state), 'EX', ttl > 0 ? ttl : OTP_TTL_SEC)
    throw new AuthError('kyc.errors.otpInvalid', 400)
  }

  await bindIdentity(redis, {
    ...identity,
    credentialHash: await hashPassword(password),
  })
  await redis.del(forgotOtpKey(phone), forgotResendKey(phone))
}

export async function loginWithTelegramWidget(
  redis: Redis,
  env: Env,
  data: Record<string, string>,
  ip?: string,
  referralCode?: string,
): Promise<{
  token: string
  expiresIn: number
  user: UserRecord
  isNewUser: boolean
  trialRedPacketEligible: boolean
}> {
  const v = verifyTelegramWidget(data, env.TELEGRAM_BOT_TOKEN)
  if (!v) throw new AuthError('Invalid or expired Telegram login', 401)

  let referredBy: string | undefined
  if (referralCode) {
    const inviter = await getUserByInviteCode(redis, referralCode.toUpperCase())
    if (inviter) referredBy = inviter.id
  }

  const displayName = [v.firstName, v.lastName].filter(Boolean).join(' ') || v.username || 'Telegram User'
  const region = ip ? lookupRegion(ip) : undefined
  const { user, isNewUser } = await createUserFromTelegram(redis, {
    telegramUserId: v.id,
    displayName,
    avatarUrl: v.photoUrl,
    telegramUsername: v.username,
    referredBy,
    registerIp: ip,
    registerRegion: region,
  })
  if (user.status === 'banned') {
    throw new AuthError('Account has been permanently banned. Please contact support.', 401)
  }
  return issueSession(redis, env, user, isNewUser)
}

export async function loginWithTelegramOidc(
  redis: Redis,
  env: Env,
  code: string,
  redirectUri: string,
  ip?: string,
  referralCode?: string,
): Promise<{
  token: string
  expiresIn: number
  user: UserRecord
  isNewUser: boolean
  trialRedPacketEligible: boolean
}> {
  if (!env.TELEGRAM_OIDC_CLIENT_SECRET) {
    throw new AuthError('Telegram web login is not configured')
  }
  if (redirectUri !== env.TELEGRAM_OIDC_REDIRECT_URI) {
    throw new AuthError('Invalid redirect URI')
  }

  try {
    const profile = await exchangeTelegramOidcCode(env, code, redirectUri)

    let referredBy: string | undefined
    if (referralCode) {
      const inviter = await getUserByInviteCode(redis, referralCode.toUpperCase())
      if (inviter) referredBy = inviter.id
    }

    const region = ip ? lookupRegion(ip) : undefined
    const { user, isNewUser } = await createUserFromTelegramOidc(redis, {
      telegramOidcSub: profile.sub,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      telegramUsername: profile.username,
      referredBy,
      registerIp: ip,
      registerRegion: region,
    })
    if (user.status === 'banned' || user.status === 'frozen') {
      throw new AuthError('Account has been disabled. Please contact support.')
    }
    return issueSession(redis, env, user, isNewUser)
  } catch (e) {
    if (e instanceof AuthError) throw e
    throw new AuthError(e instanceof Error ? e.message : 'Telegram login failed')
  }
}

// ── 身份绑定：把某登录方式挂到当前已登录账号；命中他号一律 409 ──────────────────
async function loadUser(redis: Redis, userId: string): Promise<UserRecord> {
  const user = await getUser(redis, userId)
  if (!user) throw new AuthError('User not found', 404)
  return user
}

export async function bindTelegramWidget(
  redis: Redis,
  env: Env,
  userId: string,
  data: Record<string, string>,
): Promise<UserRecord> {
  const v = verifyTelegramWidget(data, env.TELEGRAM_BOT_TOKEN)
  if (!v) throw new AuthError('Invalid or expired Telegram login', 401)
  const owner = await getUserByTelegramId(redis, v.id)
  if (owner && owner.id !== userId) throw new AuthError('该 Telegram 已绑定其他账号', 409)
  const user = await loadUser(redis, userId)
  await bindIdentity(redis, {
    userId,
    provider: 'telegram',
    identifier: String(v.id),
    displayLabel: v.username,
    verifiedAt: new Date().toISOString(),
  })
  await saveUser(redis, user)
  return user
}

export async function bindTelegramOidc(
  redis: Redis,
  env: Env,
  userId: string,
  code: string,
  redirectUri: string,
): Promise<UserRecord> {
  if (redirectUri !== env.TELEGRAM_OIDC_REDIRECT_URI) throw new AuthError('Invalid redirect URI', 400)
  const profile = await exchangeTelegramOidcCode(env, code, redirectUri)
  const owner = await getUserByTelegramOidcSub(redis, profile.sub)
  if (owner && owner.id !== userId) throw new AuthError('该 Telegram 已绑定其他账号', 409)
  const user = await loadUser(redis, userId)
  await bindIdentity(redis, {
    userId,
    provider: 'telegram_oidc',
    identifier: profile.sub,
    displayLabel: profile.username,
    verifiedAt: new Date().toISOString(),
  })
  await saveUser(redis, user)
  return user
}

export async function bindGoogleAccount(
  redis: Redis,
  env: Env,
  userId: string,
  code: string,
  redirectUri: string,
): Promise<UserRecord> {
  if (redirectUri !== env.GOOGLE_REDIRECT_URI) throw new AuthError('Invalid redirect URI', 400)
  const profile = await exchangeGoogleCode(env, code, redirectUri)
  const owner = await getUserByGoogleSub(redis, profile.sub)
  if (owner && owner.id !== userId) throw new AuthError('该 Google 已绑定其他账号', 409)
  if (profile.email) {
    const emailOwner = await getUserByEmail(redis, profile.email)
    if (emailOwner && emailOwner.id !== userId) throw new AuthError('该邮箱已被其他账号使用', 409)
  }
  const user = await loadUser(redis, userId)
  if (profile.email) {
    user.email = profile.email
  }
  await bindIdentity(redis, {
    userId,
    provider: 'google',
    identifier: profile.sub,
    displayLabel: profile.email,
    verifiedAt: new Date().toISOString(),
  })
  await saveUser(redis, user)
  return user
}

export async function bindPhone(
  redis: Redis,
  userId: string,
  phoneRaw: string,
  password?: string,
): Promise<UserRecord> {
  const phone = normalizePhonePH(phoneRaw)
  if (!phone) throw new AuthError('Invalid phone number', 400)
  // 全局互斥：手机登录号 + KYC 已验手机
  const owner = await getUserByPhoneAccount(redis, phone)
  if (owner && owner.id !== userId) throw new AuthError('该手机号已被其他账号使用', 409)
  const kycOwner = await findKycByVerifiedPhone(redis, phone, userId)
  if (kycOwner) throw new AuthError('该手机号已被其他账号使用', 409)
  const user = await loadUser(redis, userId)
  if (password) {
    if (password.length < 8) throw new AuthError('Password must be at least 8 characters', 400)
  }
  const credentialHash = password ? await hashPassword(password) : undefined
  await bindIdentity(redis, {
    userId,
    provider: 'phone',
    identifier: phone,
    credentialHash,
    displayLabel: phone,
    verifiedAt: new Date().toISOString(),
  })
  await saveUser(redis, user)
  return user
}

export async function bindAccount(
  redis: Redis,
  userId: string,
  username: string,
  password: string,
): Promise<UserRecord> {
  if (!USERNAME_RE.test(username)) {
    throw new AuthError('Username must be 4-20 letters, digits or underscore', 400)
  }
  if (!password || password.length < 8) {
    throw new AuthError('Password must be at least 8 characters', 400)
  }
  const owner = await getUserByUsername(redis, username)
  if (owner && owner.id !== userId) throw new AuthError('用户名已被占用', 409)
  const user = await loadUser(redis, userId)
  await bindIdentity(redis, {
    userId,
    provider: 'account',
    identifier: username,
    credentialHash: await hashPassword(password),
    displayLabel: username,
    verifiedAt: new Date().toISOString(),
  })
  await saveUser(redis, user)
  return user
}

async function issueSession(
  redis: Redis,
  env: Env,
  user: UserRecord,
  isNewUser: boolean,
): Promise<{
  token: string
  expiresIn: number
  user: UserRecord
  isNewUser: boolean
  trialRedPacketEligible: boolean
}> {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000).toISOString()
  await saveSession(redis, token, { userId: user.id, expiresAt }, env.SESSION_TTL_SECONDS)
  return {
    token,
    expiresIn: env.SESSION_TTL_SECONDS,
    user,
    isNewUser,
    trialRedPacketEligible: !user.trialClaimed,
  }
}

export async function resolveSession(
  redis: Redis,
  token: string,
): Promise<{ valid: boolean; userId?: string; expiresAt?: string }> {
  const session = await getSession(redis, token)
  if (!session) return { valid: false }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteSession(redis, token)
    return { valid: false }
  }
  return { valid: true, userId: session.userId, expiresAt: session.expiresAt }
}

export async function refreshSession(
  redis: Redis,
  env: Env,
  token: string,
): Promise<{ token: string; expiresIn: number } | null> {
  const session = await getSession(redis, token)
  if (!session) return null
  const user = await getUser(redis, session.userId)
  if (!user) return null
  await deleteSession(redis, token)
  const next = await issueSession(redis, env, user, false)
  return { token: next.token, expiresIn: next.expiresIn }
}

export async function logout(redis: Redis, token: string): Promise<void> {
  await deleteSession(redis, token)
}

export async function toAuthUser(redis: Redis, user: UserRecord) {
  return { ...toPublicUser(user, await listUserIdentities(redis, user.id)), isNewUser: false }
}
