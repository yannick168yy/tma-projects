import { randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { hashPassword, verifyPassword } from './admin-auth.service.js'
import { verifyTotpCode } from '../utils/totp.js'

export type PlatformRole = 'platform_super' | 'platform_ops' | 'platform_finance'

export interface PlatformSession {
  adminId: number
  username: string
  role: PlatformRole
  expiresAt: string
  /** 尚未绑定 TOTP 的受限会话：只能访问绑定流程与 /auth/me、/auth/logout */
  totpSetupRequired?: boolean
}

// 会话键不带租户前缀：平台管理员是跨租户身份，必须走无前缀客户端。
// 与租户后台的 admin:sess: 完全分开，两边同时登录也不会互相顶掉。
const SESSION_PREFIX = 'platform:sess:'
const SESSION_TTL_SECONDS = 8 * 60 * 60
// 密码已过、只差验证码的中间态。5 分钟足够掏出手机，又短到捡到 challengeToken 也没什么用
const CHALLENGE_TTL_SECONDS = 300

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${token}`
}

function challengeKey(token: string): string {
  return `platform:totp:challenge:${token}`
}

interface AdminRow extends RowDataPacket {
  id: number
  username: string
  password_hash: string
  role: PlatformRole
  enabled: number
  totp_secret: string | null
}

/**
 * 平台后台对**所有**角色强制 TOTP，租户后台却放过 ops —— 差别是故意的：
 * 租户后台的 ops 只看得到自家一个站，平台后台任何角色都看得到全部租户的资金与通道凭据，
 * 且平台域名不再有 IP 白名单兜底，密码是唯一一道锁时不够。
 */
export function shouldRequirePlatformTotp(env: { PLATFORM_TOTP_REQUIRED: boolean }): boolean {
  return env.PLATFORM_TOTP_REQUIRED
}

async function createSession(
  redis: Redis,
  account: Pick<AdminRow, 'id' | 'username' | 'role'>,
  opts: { totpSetupRequired?: boolean } = {},
): Promise<{ token: string; role: PlatformRole; username: string; totpSetupRequired?: boolean }> {
  const token = randomBytes(32).toString('hex')
  const session: PlatformSession = {
    adminId: account.id,
    username: account.username,
    role: account.role,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    ...(opts.totpSetupRequired ? { totpSetupRequired: true } : {}),
  }
  await redis.set(sessionKey(token), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS)
  await getPlatformPool().execute('UPDATE pf_admin SET last_login_at = NOW(3) WHERE id = ?', [account.id])
  return {
    token,
    role: account.role,
    username: account.username,
    ...(opts.totpSetupRequired ? { totpSetupRequired: true } : {}),
  }
}

export type PlatformLoginResult =
  | { token: string; role: PlatformRole; username: string; requiresTotp?: false; totpSetupRequired?: boolean }
  | { requiresTotp: true; challengeToken: string; expiresIn: number }

export async function loginPlatformAdmin(
  redis: Redis,
  env: { PLATFORM_TOTP_REQUIRED: boolean },
  username: string,
  password: string,
): Promise<PlatformLoginResult | null> {
  const [rows] = await getPlatformPool().query<AdminRow[]>(
    'SELECT id, username, password_hash, role, enabled, totp_secret FROM pf_admin WHERE username = ? LIMIT 1',
    [username],
  )
  const account = rows[0]
  // 账号不存在时也要走一次密码校验，避免用响应时间差探测账号是否存在
  const stored = account?.password_hash ?? 'x:0000'
  const okPassword = await verifyPassword(password, stored).catch(() => false)
  if (!account || account.enabled !== 1 || !okPassword) return null

  // 已绑定：密码只换到一张 challenge 票，没有验证码拿不到 session
  if (account.totp_secret) {
    const challengeToken = randomBytes(32).toString('hex')
    await redis.setex(challengeKey(challengeToken), CHALLENGE_TTL_SECONDS, String(account.id))
    return { requiresTotp: true, challengeToken, expiresIn: CHALLENGE_TTL_SECONDS }
  }

  // 未绑定且强制开启：发受限 session，逼着先绑完才能用后台
  if (shouldRequirePlatformTotp(env)) {
    return createSession(redis, account, { totpSetupRequired: true })
  }

  return createSession(redis, account)
}

export async function verifyPlatformTotpLogin(
  redis: Redis,
  challengeToken: string,
  code: string,
): Promise<{ token: string; role: PlatformRole; username: string } | null> {
  const key = challengeKey(challengeToken)
  const adminId = Number(await redis.get(key))
  if (!adminId) return null
  const [rows] = await getPlatformPool().query<AdminRow[]>(
    'SELECT id, username, password_hash, role, enabled, totp_secret FROM pf_admin WHERE id = ? LIMIT 1',
    [adminId],
  )
  const account = rows[0]
  if (!account || account.enabled !== 1 || !account.totp_secret) return null
  if (!verifyTotpCode(account.totp_secret, code)) return null
  // 验证码用过即焚：challenge 票不能拿去重放
  await redis.del(key)
  return createSession(redis, account)
}

export async function getPlatformAdminById(adminId: number): Promise<AdminRow | undefined> {
  const [rows] = await getPlatformPool().query<AdminRow[]>(
    'SELECT id, username, password_hash, role, enabled, totp_secret FROM pf_admin WHERE id = ? LIMIT 1',
    [adminId],
  )
  return rows[0]
}

export async function setPlatformAdminTotpSecret(adminId: number, secret: string): Promise<void> {
  await getPlatformPool().execute<ResultSetHeader>(
    'UPDATE pf_admin SET totp_secret = ? WHERE id = ?',
    [secret, adminId],
  )
}

export async function disablePlatformAdminTotp(adminId: number): Promise<void> {
  await getPlatformPool().execute<ResultSetHeader>(
    'UPDATE pf_admin SET totp_secret = NULL WHERE id = ?',
    [adminId],
  )
}

/** 绑定完成后解除受限标记，保持原 TTL —— 重新签发 token 会把刚登录的人踢回登录页 */
export async function clearPlatformTotpSetupRequired(redis: Redis, token: string): Promise<void> {
  const key = sessionKey(token)
  const raw = await redis.get(key)
  if (!raw) return
  const session = JSON.parse(raw) as PlatformSession
  if (!session.totpSetupRequired) return
  delete session.totpSetupRequired
  const ttl = await redis.ttl(key)
  if (ttl > 0) await redis.setex(key, ttl, JSON.stringify(session))
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
