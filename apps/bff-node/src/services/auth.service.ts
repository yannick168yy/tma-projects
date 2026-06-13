import { validate, parse } from '@tma.js/init-data-node'
import type { Env } from '../config/env.js'
import type { Redis } from 'ioredis'
import {
  createDevUser,
  createUserFromGoogle,
  createUserFromPassword,
  createUserFromTelegram,
  deleteSession,
  getSession,
  getUser,
  getUserByInviteCode,
  getUserByPhoneAccount,
  getUserByUsername,
  saveSession,
  saveUser,
} from './store/index.js'
import { randomToken } from '../utils/id.js'
import { normalizePhonePH } from '../utils/phone.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import type { UserRecord } from '../types/domain.js'
import { exchangeGoogleCode } from './google.service.js'
import { toPublicUser } from './userPresentation.js'
import { lookupRegion } from './geo.service.js'

export type PasswordMethod = 'phone' | 'account'

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

  try {
    validate(initDataRaw, env.TELEGRAM_BOT_TOKEN, { expiresIn: 86400 })
  } catch {
    throw new AuthError('Invalid or expired Telegram initData')
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
  const user = input.method === 'phone'
    ? await getUserByPhoneAccount(redis, identifier)
    : await getUserByUsername(redis, identifier)

  if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AuthError('Invalid credentials')
  }
  if (user.status === 'banned' || user.status === 'frozen') {
    throw new AuthError('Account has been disabled. Please contact support.')
  }
  return issueSession(redis, env, user, false)
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

export function toAuthUser(user: UserRecord) {
  return { ...toPublicUser(user), isNewUser: false }
}
