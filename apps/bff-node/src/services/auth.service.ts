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
  getCanonicalUserByTelegramOidcUsername,
  getSession,
  getUser,
  getUserIdentity,
  getUserByEmail,
  getUserByGoogleSub,
  getUserByTelegramOidcSub,
  getUserByTelegramOidcUsername,
  getUserByInviteCode,
  getUserByPhoneAccount,
  getUserByTelegramId,
  listUserIdentities,
  reassignIdentity,
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
import { enforceSmsDailyLimit, getOtpLockSeconds, getSmsDailyIpLimit, getSmsDailyLimit, recordSmsSent } from './otp-policy.service.js'
import { exchangeGoogleCode } from './google.service.js'
import { exchangeTelegramOidcCode } from './telegramOidc.service.js'
import { toPublicUser } from './userPresentation.js'
import { lookupRegion } from './geo.service.js'
import { findEntryBotAgent, attributeAgentByBot, isEnabledAgentDomain } from './agent.service.js'

export type PasswordMethod = 'phone'

const OTP_TTL_SEC = 300
const RESEND_INTERVAL_SEC = 60
const MAX_VERIFY_ATTEMPTS = 3
const REGISTERED_GOOGLE_AUTH_DOMAINS = new Set([
  'betogo666.com',
  'betogo777.com',
  'betogo888.com',
  'betogo.ph',
  'betogo.xyz',
  'betogo.cc',
  'betogo.app',
  'betogo.vip',
])

function hasTelegramOidcDomainConfig(env: Env, host: string): boolean {
  const configs = [env.TELEGRAM_OIDC_CLIENTS, env.TELEGRAM_OIDC_BOT_TOKENS]
  return configs.some((config) => config
    .split(',')
    .some((item) => item.split('=')[0].trim().toLowerCase() === host))
}

export class AuthError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

function assertUserCanLogin(user: UserRecord, status = 401): void {
  if (user.status === 'banned' || user.status === 'frozen') {
    throw new AuthError('Account has been disabled. Please contact support.', status)
  }
}

// redirect_uri 白名单：配置项按逗号分隔，Google 已配置域名，或命中后台已启用代理域名的固定 callback path
async function assertAllowedRedirect(env: Env, configured: string, redirectUri: string, callbackPath: string): Promise<void> {
  const allowed = configured
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!allowed.includes(redirectUri)) {
    let url: URL
    try {
      url = new URL(redirectUri)
    } catch {
      throw new AuthError('Invalid redirect URI', 400)
    }
    if (url.protocol !== 'https:' || url.pathname !== callbackPath || url.search || url.hash) {
      throw new AuthError('Invalid redirect URI', 400)
    }
    if (callbackPath === '/auth/google/callback' && REGISTERED_GOOGLE_AUTH_DOMAINS.has(url.hostname)) return
    if (callbackPath === '/auth/telegram/callback' && hasTelegramOidcDomainConfig(env, url.hostname)) return
    if (!(await isEnabledAgentDomain(env, url.hostname))) throw new AuthError('Invalid redirect URI', 400)
  }
}

function displayNameFromInit(data: ReturnType<typeof parse>): string {
  const u = data.user
  if (!u) return 'Telegram User'
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Telegram User'
}

function telegramIdFromOidcSub(sub: string): number | null {
  if (!/^\d+$/.test(sub)) return null
  const id = Number(sub)
  return Number.isSafeInteger(id) ? id : null
}

function referralCodeFromStartParam(startParam?: string): string | undefined {
  const code = startParam?.trim().replace(/^(ref|inv)_/i, '').trim()
  return code || undefined
}

async function bindTelegramIdentity(
  redis: Redis,
  userId: string,
  telegramUserId: number,
  telegramUsername?: string,
): Promise<void> {
  const owner = await getUserByTelegramId(redis, telegramUserId)
  if (owner && owner.id !== userId) throw new AuthError('该 Telegram 已绑定其他账号', 409)
  await bindIdentity(redis, {
    userId,
    provider: 'telegram',
    identifier: String(telegramUserId),
    displayLabel: telegramUsername,
    verifiedAt: new Date().toISOString(),
  })
}

async function reassignTelegramIdentity(
  redis: Redis,
  userId: string,
  telegramUserId: number,
  telegramUsername?: string,
): Promise<void> {
  await reassignIdentity(redis, {
    userId,
    provider: 'telegram',
    identifier: String(telegramUserId),
    displayLabel: telegramUsername,
    verifiedAt: new Date().toISOString(),
  })
}

async function reassignTelegramOidcIdentity(
  redis: Redis,
  userId: string,
  telegramOidcSub: string,
  telegramUsername?: string,
): Promise<void> {
  await reassignIdentity(redis, {
    userId,
    provider: 'telegram_oidc',
    identifier: telegramOidcSub,
    displayLabel: telegramUsername,
    verifiedAt: new Date().toISOString(),
  })
}

async function bindTelegramOidcIdentity(
  redis: Redis,
  userId: string,
  telegramOidcSub: string,
  telegramUsername?: string,
): Promise<void> {
  const owner = await getUserByTelegramOidcSub(redis, telegramOidcSub)
  if (owner && owner.id !== userId) throw new AuthError('该 Telegram 已绑定其他账号', 409)
  await bindIdentity(redis, {
    userId,
    provider: 'telegram_oidc',
    identifier: telegramOidcSub,
    displayLabel: telegramUsername,
    verifiedAt: new Date().toISOString(),
  })
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
  const refCode = referralCodeFromStartParam(startParam) ?? referralCodeFromStartParam(parsed.startParam)
  if (refCode) {
    const inviter = await getUserByInviteCode(redis, refCode.toUpperCase())
    if (inviter) referredBy = inviter.id
  }

  const region = ip ? lookupRegion(ip) : undefined
  const oidcUserByUsername = parsed.user.username
    ? await getUserByTelegramOidcUsername(redis, parsed.user.username)
    : null
  if (oidcUserByUsername) {
    await reassignTelegramIdentity(redis, oidcUserByUsername.id, tgUserId, parsed.user.username)
    oidcUserByUsername.displayName = displayName
    if (avatarUrl) oidcUserByUsername.avatarUrl = avatarUrl
    await saveUser(redis, oidcUserByUsername)
    assertUserCanLogin(oidcUserByUsername)
    return issueSession(redis, env, oidcUserByUsername, false)
  }

  const oidcUser = await getUserByTelegramOidcSub(redis, String(tgUserId))
  if (oidcUser) {
    await bindTelegramIdentity(redis, oidcUser.id, tgUserId, parsed.user.username)
    oidcUser.displayName = displayName
    if (avatarUrl) oidcUser.avatarUrl = avatarUrl
    await saveUser(redis, oidcUser)
    assertUserCanLogin(oidcUser)
    return issueSession(redis, env, oidcUser, false)
  }

  const { user, isNewUser } = await createUserFromTelegram(redis, {
    telegramUserId: tgUserId,
    displayName,
    avatarUrl,
    telegramUsername: parsed.user.username,
    referredBy,
    registerIp: ip,
    registerRegion: region,
  })

  assertUserCanLogin(user)

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

  await assertAllowedRedirect(env, env.GOOGLE_REDIRECT_URI, redirectUri, '/auth/google/callback')

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
    assertUserCanLogin(user)
    return issueSession(redis, env, user, isNewUser)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Google login failed'
    throw new AuthError(message)
  }
}

function normalizeIdentifier(_method: PasswordMethod, identifier: string): string {
  const e164 = normalizePhonePH(identifier.trim())
  if (!e164) throw new AuthError('Invalid phone number', 400)
  return e164
}

const forgotOtpKey = (phone: string) => `auth:forgot:otp:${phone}`
const forgotResendKey = (phone: string) => `auth:forgot:sent:${phone}`
const forgotLockKey = (phone: string) => `auth:forgot:lock:${phone}`

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

  const existing = await getUserByPhoneAccount(redis, identifier)
  if (existing) {
    throw new AuthError('Phone already registered', 409)
  }
  // 手机全局互斥：注册手机不能是他号已验证的 KYC 手机
  if (await findKycByVerifiedPhone(redis, identifier, '')) {
    throw new AuthError('kyc.errors.phoneTaken', 409)
  }

  let referredBy: string | undefined
  if (input.referralCode) {
    const inviter = await getUserByInviteCode(redis, input.referralCode.toUpperCase())
    if (inviter) referredBy = inviter.id
  }

  const passwordHash = await hashPassword(input.password)
  const region = ip ? lookupRegion(ip) : undefined
  let created: { user: UserRecord; isNewUser: boolean }
  try {
    created = await createUserFromPassword(redis, {
      identifierType: input.method,
      identifier,
      passwordHash,
      displayName: identifier,
      referredBy,
      registerIp: ip,
      registerRegion: region,
    })
  } catch (e) {
    // 同号并发注册竞态：预检通过但 bindIdentity 撞唯一键，与预检命中同语义返 409
    if (e instanceof Error && e.message === 'Identity already bound to another account') {
      throw new AuthError('Phone already registered', 409)
    }
    throw e
  }
  return issueSession(redis, env, created.user, created.isNewUser)
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

  if (!user || !identity?.credentialHash) {
    throw new AuthError('Account not found')
  }
  if (!(await verifyPassword(input.password, identity.credentialHash))) {
    throw new AuthError('Invalid credentials')
  }
  assertUserCanLogin(user)
  return issueSession(redis, env, user, false)
}

export async function sendForgotPasswordOtp(
  redis: Redis,
  env: Env,
  phoneRaw: string,
  ip?: string,
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
  if (await redis.get(forgotLockKey(phone))) throw new AuthError('kyc.errors.otpLocked', 429)
  try {
    await enforceSmsDailyLimit(redis, await getSmsDailyLimit(env), `user:${user.id}`)
    if (ip) await enforceSmsDailyLimit(redis, await getSmsDailyIpLimit(env), `ip:${ip}`)
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : 'kyc.errors.smsDailyLimit', 429)
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
  await recordSmsSent(redis, `user:${user.id}`)
  if (ip) await recordSmsSent(redis, `ip:${ip}`)
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
  env: Env,
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

  if (await redis.get(forgotLockKey(phone))) throw new AuthError('kyc.errors.otpLocked', 429)
  const raw = await redis.get(forgotOtpKey(phone))
  if (!raw) throw new AuthError('kyc.errors.otpExpired', 400)
  const state = JSON.parse(raw) as ForgotOtpState
  if (state.attempts >= MAX_VERIFY_ATTEMPTS) {
    state.attempts = 0
    const ttl = await redis.ttl(forgotOtpKey(phone))
    await redis.set(forgotOtpKey(phone), JSON.stringify(state), 'EX', ttl > 0 ? ttl : OTP_TTL_SEC)
    await redis.set(forgotLockKey(phone), '1', 'EX', await getOtpLockSeconds(env))
    throw new AuthError('kyc.errors.otpTooManyAttempts', 429)
  }
  if (code !== state.code) {
    state.attempts += 1
    const ttl = await redis.ttl(forgotOtpKey(phone))
    await redis.set(forgotOtpKey(phone), JSON.stringify(state), 'EX', ttl > 0 ? ttl : OTP_TTL_SEC)
    if (state.attempts >= MAX_VERIFY_ATTEMPTS) {
      state.attempts = 0
      await redis.set(forgotOtpKey(phone), JSON.stringify(state), 'EX', ttl > 0 ? ttl : OTP_TTL_SEC)
      await redis.set(forgotLockKey(phone), '1', 'EX', await getOtpLockSeconds(env))
      throw new AuthError('kyc.errors.otpTooManyAttempts', 429)
    }
    throw new AuthError('kyc.errors.otpInvalid', 400)
  }

  await bindIdentity(redis, {
    ...identity,
    credentialHash: await hashPassword(password),
  })
  await redis.del(forgotOtpKey(phone), forgotResendKey(phone), forgotLockKey(phone))
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
  const oidcUserByUsername = v.username ? await getUserByTelegramOidcUsername(redis, v.username) : null
  if (oidcUserByUsername) {
    await reassignTelegramIdentity(redis, oidcUserByUsername.id, v.id, v.username)
    oidcUserByUsername.displayName = displayName
    if (v.photoUrl) oidcUserByUsername.avatarUrl = v.photoUrl
    await saveUser(redis, oidcUserByUsername)
    assertUserCanLogin(oidcUserByUsername, 401)
    return issueSession(redis, env, oidcUserByUsername, false)
  }

  const oidcUser = await getUserByTelegramOidcSub(redis, String(v.id))
  if (oidcUser) {
    await bindTelegramIdentity(redis, oidcUser.id, v.id, v.username)
    oidcUser.displayName = displayName
    if (v.photoUrl) oidcUser.avatarUrl = v.photoUrl
    await saveUser(redis, oidcUser)
    assertUserCanLogin(oidcUser, 401)
    return issueSession(redis, env, oidcUser, false)
  }

  const { user, isNewUser } = await createUserFromTelegram(redis, {
    telegramUserId: v.id,
    displayName,
    avatarUrl: v.photoUrl,
    telegramUsername: v.username,
    referredBy,
    registerIp: ip,
    registerRegion: region,
  })
  assertUserCanLogin(user, 401)
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
  if (!env.TELEGRAM_OIDC_CLIENT_SECRET && !env.TELEGRAM_OIDC_CLIENTS && !env.TELEGRAM_OIDC_BOT_TOKENS) {
    throw new AuthError('Telegram web login is not configured')
  }
  await assertAllowedRedirect(env, env.TELEGRAM_OIDC_REDIRECT_URI, redirectUri, '/auth/telegram/callback')

  try {
    const profile = await exchangeTelegramOidcCode(env, code, redirectUri)

    let referredBy: string | undefined
    if (referralCode) {
      const inviter = await getUserByInviteCode(redis, referralCode.toUpperCase())
      if (inviter) referredBy = inviter.id
    }

    const region = ip ? lookupRegion(ip) : undefined
    const telegramUserId = telegramIdFromOidcSub(profile.sub)

    const oidcUserByUsername = profile.username
      ? await getCanonicalUserByTelegramOidcUsername(redis, profile.username)
      : null
    if (oidcUserByUsername) {
      await reassignTelegramOidcIdentity(redis, oidcUserByUsername.id, profile.sub, profile.username)
      if (telegramUserId) await bindTelegramIdentity(redis, oidcUserByUsername.id, telegramUserId, profile.username)
      oidcUserByUsername.displayName = profile.displayName
      if (profile.avatarUrl) oidcUserByUsername.avatarUrl = profile.avatarUrl
      await saveUser(redis, oidcUserByUsername)
      assertUserCanLogin(oidcUserByUsername)
      return issueSession(redis, env, oidcUserByUsername, false)
    }

    const telegramUser = telegramUserId ? await getUserByTelegramId(redis, telegramUserId) : null
    if (telegramUser) {
      await bindTelegramOidcIdentity(redis, telegramUser.id, profile.sub, profile.username)
      telegramUser.displayName = profile.displayName
      if (profile.avatarUrl) telegramUser.avatarUrl = profile.avatarUrl
      await saveUser(redis, telegramUser)
      assertUserCanLogin(telegramUser)
      return issueSession(redis, env, telegramUser, false)
    }

    const { user, isNewUser } = await createUserFromTelegramOidc(redis, {
      telegramOidcSub: profile.sub,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      telegramUsername: profile.username,
      referredBy,
      registerIp: ip,
      registerRegion: region,
    })
    if (telegramUserId) await bindTelegramIdentity(redis, user.id, telegramUserId, profile.username)
    assertUserCanLogin(user)
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
  const oidcOwner = await getUserByTelegramOidcSub(redis, String(v.id))
  if (oidcOwner && oidcOwner.id !== userId) throw new AuthError('该 Telegram 已绑定其他账号', 409)
  const user = await loadUser(redis, userId)
  await bindTelegramIdentity(redis, userId, v.id, v.username)
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
  await assertAllowedRedirect(env, env.TELEGRAM_OIDC_REDIRECT_URI, redirectUri, '/auth/telegram/callback')
  const profile = await exchangeTelegramOidcCode(env, code, redirectUri)
  const telegramUserId = telegramIdFromOidcSub(profile.sub)
  if (telegramUserId) {
    const telegramOwner = await getUserByTelegramId(redis, telegramUserId)
    if (telegramOwner && telegramOwner.id !== userId) throw new AuthError('该 Telegram 已绑定其他账号', 409)
  }
  const user = await loadUser(redis, userId)
  await bindTelegramOidcIdentity(redis, userId, profile.sub, profile.username)
  if (telegramUserId) await bindTelegramIdentity(redis, userId, telegramUserId, profile.username)
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
  await assertAllowedRedirect(env, env.GOOGLE_REDIRECT_URI, redirectUri, '/auth/google/callback')
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
  password: string,
): Promise<UserRecord> {
  const phone = normalizePhonePH(phoneRaw)
  if (!phone) throw new AuthError('Invalid phone number', 400)
  // 全局互斥：手机登录号 + KYC 已验手机
  const owner = await getUserByPhoneAccount(redis, phone)
  if (owner && owner.id !== userId) throw new AuthError('kyc.errors.phoneTaken', 409)
  const kycOwner = await findKycByVerifiedPhone(redis, phone, userId)
  if (kycOwner) throw new AuthError('kyc.errors.phoneTaken', 409)
  const user = await loadUser(redis, userId)
  if (password.length < 8) throw new AuthError('Password must be at least 8 characters', 400)
  const credentialHash = await hashPassword(password)
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

export type WithdrawPhoneCheck =
  | { ok: true; phone: string }
  | { ok: false; status: number; error: string }

/**
 * 手机钱包（GCash/Maya）取款收款号归属校验 + 首次绑定。
 * - 本人已绑手机 → 收款号必须等于本人号，否则拒绝（不允许取到别的号）。
 * - 本人未绑手机 → 号码若已属其他用户（登录号或已验证 KYC）则拒绝；否则强制绑定到本人。
 *   绑定为「无登录凭证的手机 identity」：仅登记归属并锁定后续取款，不开启手机登录（passwordLogin 无 hash 即拒）。
 * 防止用户把取款打到他人手机号（历史漏洞：取款流程从不校验 targetAccount 归属）。
 */
export async function checkWithdrawPhoneAccount(
  redis: Redis,
  userId: string,
  rawAccount: string,
): Promise<WithdrawPhoneCheck> {
  const phone = normalizePhonePH(rawAccount)
  if (!phone) return { ok: false, status: 400, error: 'errors.invalidWithdrawAccount' }

  const ownPhone = (await listUserIdentities(redis, userId)).find((i) => i.provider === 'phone')
  if (ownPhone) {
    if (ownPhone.identifier !== phone) return { ok: false, status: 400, error: 'errors.withdrawPhoneMismatch' }
    return { ok: true, phone }
  }

  const owner = await getUserByPhoneAccount(redis, phone)
  if (owner && owner.id !== userId) return { ok: false, status: 409, error: 'errors.withdrawPhoneTaken' }
  if (await findKycByVerifiedPhone(redis, phone, userId)) return { ok: false, status: 409, error: 'errors.withdrawPhoneTaken' }

  await bindIdentity(redis, {
    userId,
    provider: 'phone',
    identifier: phone,
    displayLabel: phone,
    verifiedAt: new Date().toISOString(),
  })
  return { ok: true, phone }
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
  const user = await getUser(redis, session.userId)
  if (!user || user.status === 'banned' || user.status === 'frozen') {
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
  if (!user || user.status === 'banned' || user.status === 'frozen') {
    await deleteSession(redis, token)
    return null
  }
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
