import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

export interface AdminAccount {
  id: number
  username: string
  passwordHash: string
  role: 'super_admin' | 'finance' | 'ops' | 'support'
  status: 'active' | 'disabled'
  lastLoginAt?: string
  createdAt: string
}

type AdminRow = RowDataPacket & {
  id: number
  username: string
  password_hash: string
  role: string
  status: string
  last_login_at: Date | null
  created_at: Date
}

function mapAdmin(row: AdminRow): AdminAccount {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role as AdminAccount['role'],
    status: row.status as AdminAccount['status'],
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export async function countAdmins(env: Env): Promise<number> {
  const [rows] = await pool(env).query<RowDataPacket[]>(`SELECT COUNT(*) as n FROM admin_accounts`)
  return Number(rows[0]?.n ?? 0)
}

export async function createAdmin(
  env: Env,
  data: Pick<AdminAccount, 'username' | 'passwordHash' | 'role'>,
): Promise<void> {
  await pool(env).execute(
    `INSERT INTO admin_accounts (username, password_hash, role) VALUES (?,?,?)`,
    [data.username, data.passwordHash, data.role],
  )
}

export async function getAdminByUsername(env: Env, username: string): Promise<AdminAccount | null> {
  const [rows] = await pool(env).query<AdminRow[]>(
    `SELECT * FROM admin_accounts WHERE username = ?`,
    [username],
  )
  return rows[0] ? mapAdmin(rows[0]) : null
}

export async function getAdminById(env: Env, id: number): Promise<AdminAccount | null> {
  const [rows] = await pool(env).query<AdminRow[]>(
    `SELECT * FROM admin_accounts WHERE id = ?`,
    [id],
  )
  return rows[0] ? mapAdmin(rows[0]) : null
}

export async function updateLastLogin(env: Env, id: number): Promise<void> {
  await pool(env).execute(
    `UPDATE admin_accounts SET last_login_at = NOW(3) WHERE id = ?`,
    [id],
  )
}

export async function writeAuditLog(
  env: Env,
  entry: {
    adminId: number
    adminUsername: string
    action: string
    targetType?: string
    targetId?: string
    detail?: unknown
    ip?: string
  },
): Promise<void> {
  await pool(env).execute(
    `INSERT INTO admin_audit_log (admin_id, admin_username, action, target_type, target_id, detail, ip)
     VALUES (?,?,?,?,?,?,?)`,
    [
      entry.adminId,
      entry.adminUsername,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.detail != null ? JSON.stringify(entry.detail) : null,
      entry.ip ?? null,
    ],
  )
}

export async function listAuditLog(
  env: Env,
  page = 1,
  pageSize = 50,
): Promise<{ id: number; adminUsername: string; action: string; targetType: string | null; targetId: string | null; detail: unknown; ip: string | null; createdAt: string }[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    adminUsername: String(r.admin_username),
    action: String(r.action),
    targetType: r.target_type ? String(r.target_type) : null,
    targetId: r.target_id ? String(r.target_id) : null,
    detail: r.detail ?? null,
    ip: r.ip ? String(r.ip) : null,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))
}

export interface DashboardStats {
  totalUsers: number
  activeUsers: number
  frozenUsers: number
  todayDepositCount: number
  todayDepositAmount: number
  todayWithdrawCount: number
  todayWithdrawAmount: number
  pendingWithdrawCount: number
  totalBalanceCents: number
}

export async function getDashboardStats(env: Env): Promise<DashboardStats> {
  const [uRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT status, COUNT(*) as cnt FROM bg_user GROUP BY status`,
  )
  let totalUsers = 0; let activeUsers = 0; let frozenUsers = 0
  for (const r of uRows) {
    totalUsers += Number(r.cnt)
    if (r.status === 'active') activeUsers = Number(r.cnt)
    if (r.status === 'frozen') frozenUsers = Number(r.cnt)
  }

  const [dRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as amt
     FROM bg_deposit_order WHERE DATE(created_at) = CURDATE() AND status = 'paid'`,
  )
  const todayDepositCount = Number(dRows[0]?.cnt ?? 0)
  const todayDepositAmount = Number(dRows[0]?.amt ?? 0)

  const [wdRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(amount_cents),0) as amt
     FROM bg_withdraw_order WHERE DATE(created_at) = CURDATE() AND status IN ('completed','processing')`,
  )
  const todayWithdrawCount = Number(wdRows[0]?.cnt ?? 0)
  const todayWithdrawAmount = Number(wdRows[0]?.amt ?? 0)

  const [pwRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM bg_withdraw_order WHERE status = 'pending'`,
  )
  const pendingWithdrawCount = Number(pwRows[0]?.cnt ?? 0)

  const [balRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(available_cents),0) as total FROM bg_wallet`,
  )
  const totalBalanceCents = Number(balRows[0]?.total ?? 0)

  return {
    totalUsers, activeUsers, frozenUsers,
    todayDepositCount, todayDepositAmount,
    todayWithdrawCount, todayWithdrawAmount,
    pendingWithdrawCount, totalBalanceCents,
  }
}

export async function listAdminUsers(
  env: Env,
  opts: { page: number; pageSize: number; search?: string; status?: string },
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.search) {
    conditions.push(`(u.id LIKE ? OR u.display_name LIKE ? OR u.email LIKE ? OR u.telegram_username LIKE ?)`)
    const like = `%${opts.search}%`
    params.push(like, like, like, like)
  }
  if (opts.status) {
    conditions.push(`u.status = ?`)
    params.push(opts.status)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM bg_user u ${where}`,
    params,
  )
  const total = Number(countRows[0]?.cnt ?? 0)

  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT u.id, u.display_name, u.email, u.telegram_username, u.status, u.label,
            u.last_login_at, u.registered_at,
            COALESCE(w.available_cents,0) as available_cents
     FROM bg_user u
     LEFT JOIN bg_wallet w ON w.user_id = u.id
     ${where}
     ORDER BY u.registered_at DESC
     LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, offset],
  )

  const items = rows.map((r) => ({
    id: String(r.id),
    displayName: String(r.display_name),
    email: r.email ? String(r.email) : null,
    telegramUsername: r.telegram_username ? String(r.telegram_username) : null,
    status: String(r.status),
    label: String(r.label ?? 'normal'),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at as Date).toISOString() : null,
    registeredAt: new Date(r.registered_at as Date).toISOString(),
    balanceCents: Number(r.available_cents),
  }))

  return { total, items }
}

export async function listAdminDeposits(
  env: Env,
  opts: { page: number; pageSize: number; userId?: string; status?: string },
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.userId) { conditions.push(`user_id = ?`); params.push(opts.userId) }
  if (opts.status) { conditions.push(`status = ?`); params.push(opts.status) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM bg_deposit_order ${where}`, params,
  )
  const total = Number(countRows[0]?.cnt ?? 0)

  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_deposit_order ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, offset],
  )

  const items = rows.map((r) => ({
    orderId: String(r.order_id),
    userId: String(r.user_id),
    amount: Number(r.amount),
    currency: String(r.currency),
    channelId: String(r.channel_id),
    status: String(r.status),
    createdAt: new Date(r.created_at as Date).toISOString(),
    paidAt: r.paid_at ? new Date(r.paid_at as Date).toISOString() : null,
    creditedCents: r.credited_cents != null ? Number(r.credited_cents) : null,
  }))

  return { total, items }
}

export async function updateUserLabel(env: Env, userId: string, label: string): Promise<void> {
  await pool(env).execute(`UPDATE bg_user SET label = ? WHERE id = ?`, [label, userId])
}

export async function getLoginLogs(
  env: Env,
  userId: string,
  limit = 20,
): Promise<{ id: number; ip: string | null; userAgent: string | null; authMethod: string; createdAt: string }[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT id, ip, user_agent, auth_method, created_at FROM bg_login_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    ip: r.ip ? String(r.ip) : null,
    userAgent: r.user_agent ? String(r.user_agent) : null,
    authMethod: String(r.auth_method),
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))
}

export async function getBetOrders(
  env: Env,
  userId: string,
  limit = 30,
): Promise<{ id: number; providerTxnId: string; roundId: string | null; betType: string; amountCents: number; status: string; createdAt: string }[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT id, provider_txn_id, round_id, bet_type, amount_cents, status, created_at
     FROM bg_bet_order WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    providerTxnId: String(r.provider_txn_id),
    roundId: r.round_id ? String(r.round_id) : null,
    betType: String(r.bet_type),
    amountCents: Number(r.amount_cents),
    status: String(r.status),
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))
}

export async function listAdminGames(
  env: Env,
  opts: { page: number; pageSize: number; provider?: string; search?: string; isActive?: boolean },
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.provider) { conditions.push('provider = ?'); params.push(opts.provider) }
  if (opts.search) { conditions.push('name LIKE ?'); params.push(`%${opts.search}%`) }
  if (opts.isActive !== undefined) { conditions.push('is_active = ?'); params.push(opts.isActive ? 1 : 0) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM sg_games ${where}`, params,
  )
  const total = Number(countRows[0]?.cnt ?? 0)

  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT uuid, name, provider, category, sub_category, image_url, has_demo, has_lobby, is_mobile, is_active, updated_at
     FROM sg_games ${where} ORDER BY provider, name LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, offset],
  )

  const [provRows] = await pool(env).query<RowDataPacket[]>(`SELECT DISTINCT provider FROM sg_games ORDER BY provider`)
  const providers = provRows.map((r) => String(r.provider))

  const items = rows.map((r) => ({
    uuid: String(r.uuid),
    name: String(r.name),
    provider: String(r.provider),
    category: r.category ? String(r.category) : null,
    subCategory: r.sub_category ? String(r.sub_category) : null,
    imageUrl: r.image_url ? String(r.image_url) : null,
    hasDemo: Boolean(r.has_demo),
    hasLobby: Boolean(r.has_lobby),
    isMobile: Boolean(r.is_mobile),
    isActive: Boolean(r.is_active),
    updatedAt: new Date(r.updated_at as Date).toISOString(),
  }))

  return { total, items, providers }
}

export async function toggleAdminGame(env: Env, uuid: string, isActive: boolean): Promise<void> {
  await pool(env).execute(`UPDATE sg_games SET is_active = ? WHERE uuid = ?`, [isActive ? 1 : 0, uuid])
}

export async function getOpPasswordHash(env: Env): Promise<string | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT \`value\` FROM bg_admin_settings WHERE \`key\` = 'op_password'`,
  )
  return rows[0] ? String(rows[0].value) : null
}

export async function setOpPassword(env: Env, hash: string): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_admin_settings (\`key\`, \`value\`) VALUES ('op_password', ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
    [hash],
  )
}

export async function listAdminWithdrawals(
  env: Env,
  opts: { page: number; pageSize: number; userId?: string; status?: string },
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.userId) { conditions.push(`user_id = ?`); params.push(opts.userId) }
  if (opts.status) { conditions.push(`status = ?`); params.push(opts.status) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM bg_withdraw_order ${where}`, params,
  )
  const total = Number(countRows[0]?.cnt ?? 0)

  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_withdraw_order ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, offset],
  )

  const items = rows.map((r) => ({
    orderId: String(r.order_id),
    userId: String(r.user_id),
    amount: Number(r.amount_cents),
    currency: String(r.currency),
    channelId: String(r.channel_id),
    status: String(r.status),
    createdAt: new Date(r.created_at as Date).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at as Date).toISOString() : null,
    rejectReason: r.reject_reason ? String(r.reject_reason) : null,
  }))

  return { total, items }
}
