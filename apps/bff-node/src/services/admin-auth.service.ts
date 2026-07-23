import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import {
  getAdminByUsername,
  getAdminById,
  updateLastLogin,
  countAdmins,
  createAdmin,
  type AdminAccount,
} from './admin-store.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { randomToken } from '../utils/id.js'
import { verifyTotpCode } from '../utils/totp.js'

const scryptAsync = promisify(scrypt)
const ADMIN_SESSION_TTL = 8 * 60 * 60 // 8h

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scryptAsync(password, salt, 64)) as Buffer
  return `${salt}:${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':')
  if (!salt || !hashHex) return false
  const hash = Buffer.from(hashHex, 'hex')
  const derived = (await scryptAsync(password, salt, 64)) as Buffer
  return timingSafeEqual(hash, derived)
}

export interface AdminSession {
  adminId: number
  username: string
  role: string
  expiresAt: string
  /** 角色要求 TOTP 但尚未绑定：session 只能访问 TOTP 绑定与登出接口 */
  totpSetupRequired?: boolean
}

// 正式运营要求：高权限角色必须开二步验证
const TOTP_REQUIRED_ROLES = new Set(['super_admin', 'finance'])

export function shouldRequireAdminTotp(env: Pick<Env, 'BFF_ADMIN_TOTP_REQUIRED'>, role: string): boolean {
  return env.BFF_ADMIN_TOTP_REQUIRED && TOTP_REQUIRED_ROLES.has(role)
}

function sessionKey(token: string): string {
  return `admin:sess:${token}`
}

function totpChallengeKey(token: string): string {
  return `admin:totp:challenge:${token}`
}

async function createAdminSession(
  redis: Redis,
  env: Env,
  account: AdminAccount,
  opts: { totpSetupRequired?: boolean } = {},
): Promise<{ token: string; expiresIn: number; role: string; totpSetupRequired?: boolean }> {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL * 1000).toISOString()
  const session: AdminSession = { adminId: account.id, username: account.username, role: account.role, expiresAt }
  if (opts.totpSetupRequired) session.totpSetupRequired = true
  await redis.setex(sessionKey(token), ADMIN_SESSION_TTL, JSON.stringify(session))
  await updateLastLogin(env, account.id)
  return { token, expiresIn: ADMIN_SESSION_TTL, role: account.role, ...(opts.totpSetupRequired ? { totpSetupRequired: true } : {}) }
}

export async function loginAdmin(
  redis: Redis,
  env: Env,
  username: string,
  password: string,
): Promise<
  | { token: string; expiresIn: number; role: string; requiresTotp?: false; totpSetupRequired?: boolean }
  | { requiresTotp: true; challengeToken: string; expiresIn: number }
  | null
> {
  const account = await getAdminByUsername(env, username)
  if (!account || account.status !== 'active') return null
  const ok = await verifyPassword(password, account.passwordHash)
  if (!ok) return null

  if (account.totpEnabled && account.totpSecret) {
    const challengeToken = randomToken()
    const expiresIn = 300
    await redis.setex(totpChallengeKey(challengeToken), expiresIn, String(account.id))
    return { requiresTotp: true, challengeToken, expiresIn }
  }

  // 高权限角色未绑 TOTP：发受限 session，只允许完成绑定后再进后台
  if (shouldRequireAdminTotp(env, account.role)) {
    return createAdminSession(redis, env, account, { totpSetupRequired: true })
  }

  return createAdminSession(redis, env, account)
}

/** TOTP 绑定完成后解除 session 限制（保持原 TTL） */
export async function clearTotpSetupRequired(redis: Redis, token: string): Promise<void> {
  const key = sessionKey(token)
  const raw = await redis.get(key)
  if (!raw) return
  const session = JSON.parse(raw) as AdminSession
  if (!session.totpSetupRequired) return
  delete session.totpSetupRequired
  const ttl = await redis.ttl(key)
  if (ttl > 0) await redis.setex(key, ttl, JSON.stringify(session))
}

export async function verifyAdminTotpLogin(
  redis: Redis,
  env: Env,
  challengeToken: string,
  code: string,
): Promise<{ token: string; expiresIn: number; role: string } | null> {
  const key = totpChallengeKey(challengeToken)
  const adminId = Number(await redis.get(key))
  if (!adminId) return null
  const account = await getAdminById(env, adminId)
  if (!account || account.status !== 'active' || !account.totpEnabled || !account.totpSecret) return null
  if (!verifyTotpCode(account.totpSecret, code)) return null
  await redis.del(key)
  return createAdminSession(redis, env, account)
}

export async function getAdminSession(redis: Redis, token: string): Promise<AdminSession | null> {
  const raw = await redis.get(sessionKey(token))
  if (!raw) return null
  const session = JSON.parse(raw) as AdminSession
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await redis.del(sessionKey(token))
    return null
  }
  return session
}

export async function logoutAdmin(redis: Redis, token: string): Promise<void> {
  await redis.del(sessionKey(token))
}

export async function changeAdminPassword(
  env: Env,
  adminId: number,
  currentPassword: string,
  newPassword: string,
): Promise<'ok' | 'wrong_password' | 'not_found'> {
  const account = await getAdminById(env, adminId)
  if (!account) return 'not_found'
  const valid = await verifyPassword(currentPassword, account.passwordHash)
  if (!valid) return 'wrong_password'
  const newHash = await hashPassword(newPassword)
  const pool = getMysqlPool(env)
  await pool.execute(`UPDATE admin_accounts SET password_hash = ? WHERE id = ?`, [newHash, adminId])
  return 'ok'
}

export async function seedDefaultAdmin(env: Env): Promise<void> {
  if (env.NODE_ENV === 'production') return
  const count = await countAdmins(env)
  if (count > 0) return
  const passwordHash = await hashPassword('Betogo@2025')
  await createAdmin(env, { username: 'admin', passwordHash, role: 'super_admin' })
  console.log('[admin-seed] Created default admin account: admin / Betogo@2025')
}
