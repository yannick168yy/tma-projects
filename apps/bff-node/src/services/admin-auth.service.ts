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
} from './admin-store.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { randomToken } from '../utils/id.js'

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
}

function sessionKey(token: string): string {
  return `admin:sess:${token}`
}

export async function loginAdmin(
  redis: Redis,
  env: Env,
  username: string,
  password: string,
): Promise<{ token: string; expiresIn: number; role: string } | null> {
  const account = await getAdminByUsername(env, username)
  if (!account || account.status !== 'active') return null
  const ok = await verifyPassword(password, account.passwordHash)
  if (!ok) return null

  const token = randomToken()
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL * 1000).toISOString()
  const session: AdminSession = { adminId: account.id, username: account.username, role: account.role, expiresAt }
  await redis.setex(sessionKey(token), ADMIN_SESSION_TTL, JSON.stringify(session))
  await updateLastLogin(env, account.id)
  return { token, expiresIn: ADMIN_SESSION_TTL, role: account.role }
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
