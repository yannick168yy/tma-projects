import { randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { hashPassword, verifyPassword } from './admin-auth.service.js'

export type PlatformRole = 'platform_super' | 'platform_ops' | 'platform_finance'

export interface PlatformSession {
  adminId: number
  username: string
  role: PlatformRole
  expiresAt: string
}

// 会话键不带租户前缀：平台管理员是跨租户身份，必须走无前缀客户端。
// 与租户后台的 admin:sess: 完全分开，两边同时登录也不会互相顶掉。
const SESSION_PREFIX = 'platform:sess:'
const SESSION_TTL_SECONDS = 8 * 60 * 60

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${token}`
}

interface AdminRow extends RowDataPacket {
  id: number
  username: string
  password_hash: string
  role: PlatformRole
  enabled: number
}

export async function loginPlatformAdmin(
  redis: Redis,
  username: string,
  password: string,
): Promise<{ token: string; role: PlatformRole; username: string } | null> {
  const [rows] = await getPlatformPool().query<AdminRow[]>(
    'SELECT id, username, password_hash, role, enabled FROM pf_admin WHERE username = ? LIMIT 1',
    [username],
  )
  const account = rows[0]
  // 账号不存在时也要走一次密码校验，避免用响应时间差探测账号是否存在
  const stored = account?.password_hash ?? 'x:0000'
  const okPassword = await verifyPassword(password, stored).catch(() => false)
  if (!account || account.enabled !== 1 || !okPassword) return null

  const token = randomBytes(32).toString('hex')
  const session: PlatformSession = {
    adminId: account.id,
    username: account.username,
    role: account.role,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
  }
  await redis.set(sessionKey(token), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS)
  await getPlatformPool().execute('UPDATE pf_admin SET last_login_at = NOW(3) WHERE id = ?', [account.id])
  return { token, role: account.role, username: account.username }
}

export async function getPlatformSession(redis: Redis, token: string): Promise<PlatformSession | null> {
  const raw = await redis.get(sessionKey(token))
  if (!raw) return null
  const session = JSON.parse(raw) as PlatformSession
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await redis.del(sessionKey(token))
    return null
  }
  return session
}

export async function logoutPlatformAdmin(redis: Redis, token: string): Promise<void> {
  await redis.del(sessionKey(token))
}

/**
 * 首次启动时播种平台超管。
 * 密码只能来自环境变量：写死默认密码等于给平台后台开后门。
 */
export async function seedPlatformAdmin(): Promise<void> {
  const username = process.env.PLATFORM_ADMIN_USERNAME?.trim()
  const password = process.env.PLATFORM_ADMIN_PASSWORD?.trim()
  if (!username || !password) return
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT id FROM pf_admin WHERE username = ? LIMIT 1',
    [username],
  )
  if (rows[0]) return
  await getPlatformPool().execute(
    'INSERT INTO pf_admin (username, password_hash, role) VALUES (?, ?, ?)',
    [username, await hashPassword(password), 'platform_super'],
  )
}
