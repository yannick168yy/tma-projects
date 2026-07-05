import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { getLevelThresholds, resolveLevel } from './rebate.service.js'

export const SMS_TEST_MODE_KEY = 'sms_test_mode'
const SMS_TEST_MODE_CACHE_KEY = 'admin:setting:sms_test_mode'
const SMS_TEST_MODE_CACHE_TTL_SEC = 300

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

export interface AdminAccount {
  id: number
  username: string
  passwordHash: string
  totpSecret: string | null
  totpEnabled: boolean
  totpConfirmedAt?: string
  role: 'super_admin' | 'finance' | 'ops' | 'support'
  status: 'active' | 'disabled'
  lastLoginAt?: string
  createdAt: string
}

type AdminRow = RowDataPacket & {
  id: number
  username: string
  password_hash: string
  totp_secret: string | null
  totp_enabled: number
  totp_confirmed_at: Date | null
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
    totpSecret: row.totp_secret,
    totpEnabled: Boolean(row.totp_enabled),
    totpConfirmedAt: row.totp_confirmed_at ? new Date(row.totp_confirmed_at).toISOString() : undefined,
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

export async function setAdminTotpSecret(env: Env, id: number, secret: string): Promise<void> {
  await pool(env).execute(
    `UPDATE admin_accounts
     SET totp_secret = ?, totp_enabled = 1, totp_confirmed_at = NOW(3)
     WHERE id = ?`,
    [secret, id],
  )
}

export async function disableAdminTotp(env: Env, id: number): Promise<void> {
  await pool(env).execute(
    `UPDATE admin_accounts
     SET totp_secret = NULL, totp_enabled = 0, totp_confirmed_at = NULL
     WHERE id = ?`,
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
  totalBalance: number
  sgMultiCurrency: boolean
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
    `SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as amt
     FROM bg_withdraw_order WHERE DATE(created_at) = CURDATE() AND status IN ('completed','processing')`,
  )
  const todayWithdrawCount = Number(wdRows[0]?.cnt ?? 0)
  const todayWithdrawAmount = Number(wdRows[0]?.amt ?? 0)

  const [pwRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM bg_withdraw_order WHERE status = 'pending'`,
  )
  const pendingWithdrawCount = Number(pwRows[0]?.cnt ?? 0)

  const [balRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(available),0) as total FROM bg_wallet WHERE currency = 'PHP'`,
  )
  const totalBalance = Number(balRows[0]?.total ?? 0)

  return {
    totalUsers, activeUsers, frozenUsers,
    todayDepositCount, todayDepositAmount,
    todayWithdrawCount, todayWithdrawAmount,
    pendingWithdrawCount, totalBalance,
    sgMultiCurrency: env.SG_MULTI_CURRENCY,
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
    conditions.push(`(u.id LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?
      OR EXISTS (
        SELECT 1 FROM bg_user_identity i
        WHERE i.user_id = u.id AND i.provider IN ('telegram','telegram_oidc') AND i.display_label LIKE ?
      ))`)
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
    `SELECT u.id, u.display_name, u.email, tg.display_label AS telegram_username, u.status, u.label,
            u.last_login_at, u.last_login_region, u.register_region, u.registered_at,
            COALESCE(w.available,0) as available
     FROM bg_user u
     LEFT JOIN bg_wallet w ON w.user_id = u.id AND w.currency = 'PHP'
     LEFT JOIN (
       SELECT user_id, MAX(display_label) AS display_label
       FROM bg_user_identity
       WHERE provider IN ('telegram','telegram_oidc')
       GROUP BY user_id
     ) tg ON tg.user_id = u.id
     ${where}
     ORDER BY u.registered_at DESC
     LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, offset],
  )

  // 计算本页用户的洗码等级（按累计有效流水批量查 + 阈值映射）
  const ids = rows.map((r) => String(r.id))
  const levelMap = new Map<string, number>()
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    const [tRows] = await pool(env).query<RowDataPacket[]>(
      `SELECT user_id, SUM(effective_amount) AS total FROM bg_turnover_logs
       WHERE is_reversed = 0 AND user_id IN (${placeholders}) GROUP BY user_id`,
      ids,
    )
    const thresholds = await getLevelThresholds(env)
    for (const tr of tRows) levelMap.set(String(tr.user_id), resolveLevel(thresholds, Number(tr.total)))
  }

  const items = rows.map((r) => ({
    id: String(r.id),
    displayName: String(r.display_name),
    email: r.email ? String(r.email) : null,
    telegramUsername: r.telegram_username ? String(r.telegram_username) : null,
    status: String(r.status),
    label: String(r.label ?? 'normal'),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at as Date).toISOString() : null,
    lastLoginRegion: r.last_login_region ? String(r.last_login_region) : null,
    registerRegion: r.register_region ? String(r.register_region) : null,
    registeredAt: (() => { const d = new Date(r.registered_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    balance: Number(r.available),
    level: levelMap.get(String(r.id)) ?? 1,
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
    channelId: String(r.channel),
    status: String(r.status),
    createdAt: new Date(r.created_at as Date).toISOString(),
    paidAt: r.paid_at ? new Date(r.paid_at as Date).toISOString() : null,
    credited: r.credited != null ? Number(r.credited) : null,
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
): Promise<{ id: number; ip: string | null; region: string | null; userAgent: string | null; authMethod: string; createdAt: string }[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT id, ip, region, user_agent, auth_method, created_at FROM bg_login_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    ip: r.ip ? String(r.ip) : null,
    region: r.region ? String(r.region) : null,
    userAgent: r.user_agent ? String(r.user_agent) : null,
    authMethod: String(r.auth_method),
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))
}

export async function getBetOrders(
  env: Env,
  userId: string,
  limit = 30,
): Promise<{ id: number; providerTxnId: string; roundId: string | null; betType: string; amount: number; currencyCode: string; status: string; createdAt: string }[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT id, provider_txn_id, round_id, bet_type, amount, currency_code, status, created_at
     FROM bg_bet_order WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    providerTxnId: String(r.provider_txn_id),
    roundId: r.round_id ? String(r.round_id) : null,
    betType: String(r.bet_type),
    amount: Number(r.amount),
    currencyCode: String(r.currency_code ?? 'PHP'),
    status: String(r.status),
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))
}

export async function listAdminGames(
  env: Env,
  opts: {
    page: number; pageSize: number
    provider?: string; search?: string; isActive?: boolean
    type?: string; sortCategory?: string; volatility?: string; isFeatured?: boolean
    hasDemo?: boolean; theme?: string; gameStyle?: string; playerType?: string
    technology?: string
    weightMin?: number; weightMax?: number
    sortField?: string; sortOrder?: 'asc' | 'desc'
  },
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.provider) { conditions.push('provider = ?'); params.push(opts.provider) }
  if (opts.search) { conditions.push('(name LIKE ? OR search_keywords LIKE ?)'); params.push(`%${opts.search}%`, `%${opts.search}%`) }
  if (opts.isActive !== undefined) { conditions.push('is_active = ?'); params.push(opts.isActive ? 1 : 0) }
  if (opts.type) { conditions.push('(type = ? OR category = ?)'); params.push(opts.type, opts.type) }
  if (opts.sortCategory) { conditions.push('sort_category = ?'); params.push(opts.sortCategory) }
  if (opts.volatility) { conditions.push('volatility = ?'); params.push(opts.volatility) }
  if (opts.isFeatured !== undefined) { conditions.push('is_featured = ?'); params.push(opts.isFeatured ? 1 : 0) }
  if (opts.hasDemo !== undefined) { conditions.push('has_demo = ?'); params.push(opts.hasDemo ? 1 : 0) }
  if (opts.theme) { conditions.push('theme LIKE ?'); params.push(`%${opts.theme}%`) }
  if (opts.gameStyle) { conditions.push('game_style = ?'); params.push(opts.gameStyle) }
  if (opts.playerType) { conditions.push('player_type = ?'); params.push(opts.playerType) }
  if (opts.technology) { conditions.push('technology = ?'); params.push(opts.technology) }
  if (opts.weightMin !== undefined) { conditions.push('weight >= ?'); params.push(opts.weightMin) }
  if (opts.weightMax !== undefined) { conditions.push('weight <= ?'); params.push(opts.weightMax) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM sg_games ${where}`, params,
  )
  const total = Number(countRows[0]?.cnt ?? 0)

  const allowedSortFields: Record<string, string> = { weight: 'weight', phBonus: 'ph_bonus' }
  const sortCol = (opts.sortField && allowedSortFields[opts.sortField]) || 'weight'
  const sortDir = opts.sortOrder === 'asc' ? 'ASC' : 'DESC'

  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT uuid, name, name_id, name_vi, name_zh, type, provider, provider_id, technology,
            category, sub_category, image_url, image_hq_url,
            has_demo, has_lobby, is_mobile, has_freespins, has_tables,
            label, rtp, volatility, reels_count, lines_count, tags,
            is_active, updated_at,
            weight, ph_bonus, is_featured, sort_category, theme, game_style, player_type,
            description_en, description_zh, search_keywords, weight_updated_at
     FROM sg_games ${where} ORDER BY ${sortCol} ${sortDir}, provider, name LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, offset],
  )

  const [provRows] = await pool(env).query<RowDataPacket[]>(`SELECT DISTINCT provider FROM sg_games ORDER BY provider`)
  const providers = provRows.map((r) => String(r.provider))

  const items = rows.map((r) => ({
    uuid: String(r.uuid),
    name: String(r.name),
    nameId: r.name_id ? String(r.name_id) : null,
    nameVi: r.name_vi ? String(r.name_vi) : null,
    nameZh: r.name_zh ? String(r.name_zh) : null,
    type: r.type ? String(r.type) : null,
    provider: String(r.provider),
    providerId: r.provider_id ? Number(r.provider_id) : null,
    technology: r.technology ? String(r.technology) : null,
    category: r.category ? String(r.category) : null,
    subCategory: r.sub_category ? String(r.sub_category) : null,
    imageUrl: r.image_url ? String(r.image_url) : null,
    imageHqUrl: r.image_hq_url ? String(r.image_hq_url) : null,
    hasDemo: Boolean(r.has_demo),
    hasLobby: Boolean(r.has_lobby),
    isMobile: Boolean(r.is_mobile),
    hasFreespins: Boolean(r.has_freespins),
    hasTables: Boolean(r.has_tables),
    label: r.label ? String(r.label) : null,
    rtp: r.rtp != null ? Number(r.rtp) : null,
    volatility: r.volatility ? String(r.volatility) : null,
    reelsCount: r.reels_count ? String(r.reels_count) : null,
    linesCount: r.lines_count ? Number(r.lines_count) : null,
    tags: r.tags ? (typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags) : [],
    isActive: Boolean(r.is_active),
    updatedAt: (() => { const d = new Date(r.updated_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    weight: r.weight != null ? Number(r.weight) : 0,
    phBonus: r.ph_bonus != null ? Number(r.ph_bonus) : 0,
    isFeatured: Boolean(r.is_featured),
    sortCategory: r.sort_category ? String(r.sort_category) : null,
    theme: r.theme ? String(r.theme) : null,
    gameStyle: r.game_style ? String(r.game_style) : null,
    playerType: r.player_type ? String(r.player_type) : null,
    descriptionEn: r.description_en ? String(r.description_en) : null,
    descriptionZh: r.description_zh ? String(r.description_zh) : null,
    searchKeywords: r.search_keywords ? String(r.search_keywords) : null,
    weightUpdatedAt: (() => { const d = new Date(r.weight_updated_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
  }))

  return { total, items, providers }
}

export async function toggleAdminGame(env: Env, uuid: string, isActive: boolean): Promise<void> {
  await pool(env).execute(`UPDATE sg_games SET is_active = ? WHERE uuid = ?`, [isActive ? 1 : 0, uuid])
}

export interface ProviderStat {
  provider: string
  total: number
  active: number
  rtps?: number[]
}

export async function getProviderStats(env: Env): Promise<ProviderStat[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT provider, COUNT(*) AS total, SUM(is_active) AS active
     FROM sg_games GROUP BY provider ORDER BY provider ASC`,
  )
  return rows.map((r) => ({
    provider: String(r.provider),
    total: Number(r.total),
    active: Number(r.active),
  }))
}

export async function toggleProviderGames(env: Env, provider: string, isActive: boolean): Promise<number> {
  const [result] = await pool(env).execute(
    `UPDATE sg_games SET is_active = ? WHERE provider = ?`,
    [isActive ? 1 : 0, provider],
  )
  return (result as { affectedRows: number }).affectedRows
}

function win568SortCategoryExpr() {
  return `COALESCE(o.sort_category,
    CASE
      WHEN g.new_game_type = 203 THEN 'fishing'
      WHEN g.new_game_type = 204 THEN 'table'
      WHEN g.new_game_type = 300 THEN 'sports'
      WHEN g.new_game_type >= 100 AND g.new_game_type < 200 THEN 'live'
      WHEN g.new_game_type >= 200 AND g.new_game_type < 300 THEN 'slots'
      ELSE 'other'
    END)`
}

function win568UpstreamAvailableExpr() {
  return `(g.is_enabled = 1 AND g.is_maintain = 0 AND g.provider_status = 'Online' AND g.is_provider_online = 1)`
}

function win568LocalActiveExpr() {
  return `(COALESCE(o.is_active, 1) = 1)`
}

function parseJsonValue(value: unknown): unknown {
  if (value == null) return null
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

export async function listAdminWin568Games(
  env: Env,
  opts: {
    page: number; pageSize: number
    provider?: string | string[]; search?: string; isActive?: boolean; upstreamAvailable?: boolean
    sortCategory?: string; siteCategory?: string; volatility?: string; newGameType?: number; currency?: string; device?: string
    gameProviderId?: number; gameId?: number
    isFeatured?: boolean; coverStatus?: string; sortField?: string; sortOrder?: 'asc' | 'desc'
  },
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []
  const sortCategory = win568SortCategoryExpr()
  const upstreamAvailable = win568UpstreamAvailableExpr()
  const localActive = win568LocalActiveExpr()

  if (opts.provider) {
    const providers = Array.isArray(opts.provider) ? opts.provider : [opts.provider]
    if (providers.length === 1) {
      conditions.push('g.provider = ?')
      params.push(providers[0])
    } else {
      conditions.push(`g.provider IN (${providers.map(() => '?').join(',')})`)
      params.push(...providers)
    }
  }
  if (opts.gameProviderId !== undefined) { conditions.push('g.game_provider_id = ?'); params.push(opts.gameProviderId) }
  if (opts.gameId !== undefined) { conditions.push('g.game_id = ?'); params.push(opts.gameId) }
  if (opts.search) {
    conditions.push('(g.name_en LIKE ? OR g.name_zh LIKE ? OR o.name_override LIKE ? OR o.search_keywords LIKE ? OR CAST(g.game_id AS CHAR) LIKE ? OR CAST(g.game_provider_id AS CHAR) LIKE ?)')
    params.push(`%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`)
  }
  if (opts.isActive !== undefined) conditions.push(`${localActive} = ${opts.isActive ? 1 : 0}`)
  if (opts.upstreamAvailable !== undefined) conditions.push(`${upstreamAvailable} = ${opts.upstreamAvailable ? 1 : 0}`)
  if (opts.sortCategory) { conditions.push(`${sortCategory} = ?`); params.push(opts.sortCategory) }
  if (opts.siteCategory) { conditions.push(`COALESCE(o.site_category, g.site_category_auto, 'other') = ?`); params.push(opts.siteCategory) }
  if (opts.volatility) { conditions.push('o.volatility = ?'); params.push(opts.volatility) }
  if (opts.newGameType !== undefined) { conditions.push('g.new_game_type = ?'); params.push(opts.newGameType) }
  if (opts.currency) {
    const currency = opts.currency.toUpperCase()
    if (currency === 'USDT' || currency === 'UCC') {
      conditions.push(`(g.supported_currencies IS NULL OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('USDT')) OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('UCC')))`)
    } else {
      conditions.push(`(g.supported_currencies IS NULL OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE(?)))`)
      params.push(currency)
    }
  }
  if (opts.device) {
    conditions.push(`(g.device IS NULL OR FIND_IN_SET(?, REPLACE(REPLACE(g.device, ' ', ''), '/', ',')) > 0)`)
    params.push(opts.device)
  }
  if (opts.isFeatured !== undefined) { conditions.push('COALESCE(o.is_featured, 0) = ?'); params.push(opts.isFeatured ? 1 : 0) }
  if (opts.coverStatus) {
    // 封面状态基于探测落库的 icon_width/icon_height：宽>高横版、宽<高竖版、宽=高正方形、宽为空无封面
    const coverExpr: Record<string, string> = {
      landscape: 'g.icon_width > g.icon_height',
      portrait: 'g.icon_width < g.icon_height',
      square: 'g.icon_width IS NOT NULL AND g.icon_width = g.icon_height',
      none: 'g.icon_width IS NULL',
    }
    if (coverExpr[opts.coverStatus]) conditions.push(coverExpr[opts.coverStatus])
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [countRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     ${where}`,
    params,
  )
  const total = Number(countRows[0]?.cnt ?? 0)

  const allowedSortFields: Record<string, string> = {
    weight: 'effective_weight',
    rank: 'g.rank_no',
    gameId: 'g.game_id',
    providerId: 'g.game_provider_id',
  }
  const sortCol = (opts.sortField && allowedSortFields[opts.sortField]) || 'effective_weight'
  const sortDir = opts.sortOrder === 'asc' ? 'ASC' : 'DESC'

  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT g.game_id, g.game_provider_id, g.provider, g.new_game_type, g.game_type, g.rank_no,
            g.device, g.platform, g.rtp, g.rows_count, g.reels_count, g.lines_count,
            g.name_en, g.name_zh, g.icon_url, g.icon_width, g.icon_height, g.icon_probed_at,
            g.supported_currencies, g.block_countries,
            g.is_enabled, g.is_maintain, g.provider_status, g.is_provider_online,
            g.is_provide_commission, g.has_hedge_bet, g.synced_at, g.updated_at,
            o.is_active AS override_active, o.weight AS override_weight,
            o.is_featured AS override_featured, o.sort_category AS override_sort_category,
            o.site_category AS override_site_category, g.site_category_auto,
            COALESCE(o.site_category, g.site_category_auto, 'other') AS effective_site_category,
            o.name_override, o.image_override, o.ph_bonus, o.weight_breakdown,
            o.theme, o.game_style, o.player_type, o.description_en, o.description_zh,
            o.search_keywords, o.weight_updated_at,
            o.volatility, o.max_win_multiplier, o.rtp_official, o.release_date,
            o.min_bet, o.max_bet, o.series, o.features, o.similar_games, o.risk_flags,
            o.tagline_en, o.tagline_tl, o.description_tl, o.web_enriched_at,
            ${sortCategory} AS effective_sort_category,
            ${upstreamAvailable} AS upstream_available,
            ${localActive} AS local_active,
            COALESCE(o.weight, GREATEST(1, 10000 - COALESCE(g.rank_no, 9999))) AS effective_weight,
            COALESCE(o.is_featured, 0) AS effective_featured,
            COALESCE(o.name_override, g.name_en, g.name_zh, CONCAT('568Win ', g.game_id)) AS effective_name,
            COALESCE(o.image_override, g.icon_url) AS effective_image
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     ${where}
     ORDER BY ${sortCol} ${sortDir}, g.provider, effective_name
     LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, offset],
  )
  const [provRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT DISTINCT provider FROM bg_568win_game ORDER BY provider`,
  )

  const items = rows.map((r) => ({
    uuid: `568win:${String(r.game_provider_id)}:${String(r.game_id)}`,
    gameId: Number(r.game_id),
    gameProviderId: Number(r.game_provider_id),
    provider: r.provider ? String(r.provider) : '568Win',
    name: String(r.effective_name),
    nameEn: r.name_en ? String(r.name_en) : null,
    nameZh: r.name_zh ? String(r.name_zh) : null,
    nameOverride: r.name_override ? String(r.name_override) : null,
    imageUrl: r.effective_image ? String(r.effective_image) : null,
    iconUrl: r.icon_url ? String(r.icon_url) : null,
    iconWidth: r.icon_width == null ? null : Number(r.icon_width),
    iconHeight: r.icon_height == null ? null : Number(r.icon_height),
    iconProbedAt: (() => { const d = new Date(r.icon_probed_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    coverStatus: r.icon_width == null
      ? 'none'
      : Number(r.icon_width) > Number(r.icon_height) ? 'landscape'
      : Number(r.icon_width) < Number(r.icon_height) ? 'portrait'
      : 'square',
    imageOverride: r.image_override ? String(r.image_override) : null,
    newGameType: r.new_game_type == null ? null : Number(r.new_game_type),
    gameType: r.game_type == null ? null : Number(r.game_type),
    sortCategory: String(r.effective_sort_category),
    overrideSortCategory: r.override_sort_category ? String(r.override_sort_category) : null,
    siteCategory: String(r.effective_site_category),
    siteCategoryAuto: r.site_category_auto ? String(r.site_category_auto) : null,
    overrideSiteCategory: r.override_site_category ? String(r.override_site_category) : null,
    rankNo: r.rank_no == null ? null : Number(r.rank_no),
    device: r.device ? String(r.device) : null,
    platform: r.platform ? String(r.platform) : null,
    rtp: r.rtp == null ? null : Number(r.rtp),
    rowsCount: r.rows_count == null ? null : Number(r.rows_count),
    reelsCount: r.reels_count == null ? null : Number(r.reels_count),
    linesCount: r.lines_count == null ? null : Number(r.lines_count),
    supportedCurrencies: parseJsonValue(r.supported_currencies),
    blockCountries: parseJsonValue(r.block_countries),
    upstreamAvailable: Boolean(r.upstream_available),
    localActive: Boolean(r.local_active),
    isActive: Boolean(r.local_active) && Boolean(r.upstream_available),
    isEnabled: Boolean(r.is_enabled),
    isMaintain: Boolean(r.is_maintain),
    providerStatus: r.provider_status ? String(r.provider_status) : null,
    isProviderOnline: Boolean(r.is_provider_online),
    isProvideCommission: Boolean(r.is_provide_commission),
    hasHedgeBet: Boolean(r.has_hedge_bet),
    weight: Number(r.effective_weight ?? 0),
    overrideWeight: r.override_weight == null ? null : Number(r.override_weight),
    phBonus: r.ph_bonus == null ? null : Number(r.ph_bonus),
    weightBreakdown: parseJsonValue(r.weight_breakdown),
    theme: r.theme ? String(r.theme) : null,
    gameStyle: r.game_style ? String(r.game_style) : null,
    playerType: r.player_type ? String(r.player_type) : null,
    descriptionEn: r.description_en ? String(r.description_en) : null,
    descriptionZh: r.description_zh ? String(r.description_zh) : null,
    searchKeywords: r.search_keywords ? String(r.search_keywords) : null,
    volatility: r.volatility ? String(r.volatility) : null,
    maxWinMultiplier: r.max_win_multiplier == null ? null : Number(r.max_win_multiplier),
    rtpOfficial: r.rtp_official == null ? null : Number(r.rtp_official),
    releaseDate: (() => { const d = new Date(r.release_date as Date); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) })(),
    minBet: r.min_bet == null ? null : Number(r.min_bet),
    maxBet: r.max_bet == null ? null : Number(r.max_bet),
    series: r.series ? String(r.series) : null,
    features: parseJsonValue(r.features),
    similarGames: parseJsonValue(r.similar_games),
    riskFlags: parseJsonValue(r.risk_flags),
    taglineEn: r.tagline_en ? String(r.tagline_en) : null,
    taglineTl: r.tagline_tl ? String(r.tagline_tl) : null,
    descriptionTl: r.description_tl ? String(r.description_tl) : null,
    webEnrichedAt: (() => { const d = new Date(r.web_enriched_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    weightUpdatedAt: (() => { const d = new Date(r.weight_updated_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    isFeatured: Boolean(r.effective_featured),
    overrideFeatured: r.override_featured == null ? null : Boolean(r.override_featured),
    overrideActive: r.override_active == null ? null : Boolean(r.override_active),
    syncedAt: (() => { const d = new Date(r.synced_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    updatedAt: (() => { const d = new Date(r.updated_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
  }))

  return { total, items, providers: provRows.map((r) => String(r.provider)) }
}

export async function updateAdminWin568Game(
  env: Env,
  gameProviderId: number,
  gameId: number,
  patch: {
    isActive?: boolean | null
    weight?: number | null
    isFeatured?: boolean | null
    sortCategory?: string | null
    siteCategory?: string | null
    nameOverride?: string | null
    imageOverride?: string | null
    imageOverrideSource?: string | null
    imageAnim?: string | null
  },
): Promise<void> {
  const [[game]] = await pool(env).query<RowDataPacket[]>(
    `SELECT g.game_id, o.is_active, o.weight, o.is_featured, o.sort_category, o.site_category, o.name_override,
            o.image_override, o.image_override_source, o.image_anim
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     WHERE g.game_provider_id = ? AND g.game_id = ? LIMIT 1`,
    [gameProviderId, gameId],
  )
  if (!game) throw new Error('568Win game not found')

  await pool(env).execute(
    `INSERT INTO bg_568win_game_override
     (game_provider_id, game_id, is_active, weight, is_featured, sort_category, site_category, name_override,
      image_override, image_override_source, image_anim)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_active = VALUES(is_active),
       weight = VALUES(weight),
       is_featured = VALUES(is_featured),
       sort_category = VALUES(sort_category),
       site_category = VALUES(site_category),
       name_override = VALUES(name_override),
       image_override = VALUES(image_override),
       image_override_source = VALUES(image_override_source),
       image_anim = VALUES(image_anim)`,
    [
      gameProviderId,
      gameId,
      patch.isActive === undefined ? game.is_active : patch.isActive,
      patch.weight === undefined ? game.weight : patch.weight,
      patch.isFeatured === undefined ? game.is_featured : patch.isFeatured,
      patch.sortCategory === undefined ? game.sort_category : patch.sortCategory,
      patch.siteCategory === undefined ? game.site_category : patch.siteCategory,
      patch.nameOverride === undefined ? game.name_override : patch.nameOverride,
      patch.imageOverride === undefined ? game.image_override : patch.imageOverride,
      patch.imageOverrideSource === undefined ? game.image_override_source : patch.imageOverrideSource,
      patch.imageAnim === undefined ? game.image_anim : patch.imageAnim,
    ],
  )
}

// 某游戏各源候选封面 + 568win 上游原图，供后台换图弹窗
export async function listWin568CoverCandidates(
  env: Env,
  gameProviderId: number,
  gameId: number,
): Promise<{ source: string; url: string; animUrl: string | null }[]> {
  const [[g]] = await pool(env).query<RowDataPacket[]>(
    `SELECT g.icon_url, o.image_override, o.image_override_source
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     WHERE g.game_provider_id = ? AND g.game_id = ? LIMIT 1`,
    [gameProviderId, gameId],
  )
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT source, url, anim_url FROM bg_568win_game_cover_candidate
     WHERE game_provider_id = ? AND game_id = ? ORDER BY FIELD(source,'playtime','fbmplay','casinoplus','gzone'), source`,
    [gameProviderId, gameId],
  )
  const out = rows.map((r) => ({ source: String(r.source), url: String(r.url), animUrl: r.anim_url ? String(r.anim_url) : null }))
  // 568win 上游原图作为兜底候选（放最后）
  if (g?.icon_url) out.push({ source: '568win', url: String(g.icon_url), animUrl: null })
  return out
}

export async function toggleAdminWin568Game(env: Env, gameProviderId: number, gameId: number, isActive: boolean): Promise<void> {
  await updateAdminWin568Game(env, gameProviderId, gameId, { isActive })
}

export async function getWin568ProviderStats(env: Env): Promise<ProviderStat[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT g.provider,
            COUNT(*) AS total,
            SUM(CASE WHEN ${win568UpstreamAvailableExpr()} AND ${win568LocalActiveExpr()} THEN 1 ELSE 0 END) AS active,
            JSON_ARRAYAGG(CASE WHEN g.rtp IS NOT NULL AND g.rtp >= 0 THEN g.rtp ELSE NULL END) AS rtps
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     GROUP BY g.provider
     ORDER BY g.provider ASC`,
  )
  return rows.map((r) => ({
    provider: String(r.provider),
    total: Number(r.total),
    active: Number(r.active),
    rtps: [...new Set((parseJsonValue(r.rtps) as unknown[] | null ?? [])
      .filter((v) => v !== null)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v)))]
      .sort((a, b) => a - b),
  }))
}

export async function toggleWin568ProviderGames(env: Env, provider: string, isActive: boolean): Promise<number> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT game_provider_id, game_id FROM bg_568win_game WHERE provider = ?`,
    [provider],
  )
  for (const r of rows) {
    await pool(env).execute(
      `INSERT INTO bg_568win_game_override (game_provider_id, game_id, is_active)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE is_active = VALUES(is_active)`,
      [Number(r.game_provider_id), Number(r.game_id), isActive ? 1 : 0],
    )
  }
  return rows.length
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

export async function getAdminSetting(env: Env, key: string): Promise<string | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT \`value\` FROM bg_admin_settings WHERE \`key\` = ?`,
    [key],
  )
  return rows[0] ? String(rows[0].value) : null
}

export async function setAdminSetting(env: Env, key: string, value: string): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_admin_settings (\`key\`, \`value\`) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
    [key, value],
  )
}

export async function getSmsTestMode(redis: Redis, env: Env): Promise<boolean> {
  const cached = await redis.get(SMS_TEST_MODE_CACHE_KEY)
  if (cached === '1') return true
  if (cached === '0') return false
  const raw = await getAdminSetting(env, SMS_TEST_MODE_KEY)
  const enabled = raw === '1'
  await redis.set(SMS_TEST_MODE_CACHE_KEY, enabled ? '1' : '0', 'EX', SMS_TEST_MODE_CACHE_TTL_SEC)
  return enabled
}

export async function setSmsTestMode(redis: Redis, env: Env, enabled: boolean): Promise<void> {
  await setAdminSetting(env, SMS_TEST_MODE_KEY, enabled ? '1' : '0')
  await redis.set(SMS_TEST_MODE_CACHE_KEY, enabled ? '1' : '0', 'EX', SMS_TEST_MODE_CACHE_TTL_SEC)
}

export async function listAdminWithdrawals(
  env: Env,
  opts: { page: number; pageSize: number; userId?: string; status?: string; reviewVerdict?: string },
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.userId) { conditions.push(`user_id = ?`); params.push(opts.userId) }
  if (opts.status) { conditions.push(`status = ?`); params.push(opts.status) }
  if (opts.reviewVerdict === 'none') { conditions.push(`review_verdict IS NULL`) }
  else if (opts.reviewVerdict) { conditions.push(`review_verdict = ?`); params.push(opts.reviewVerdict) }

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
    amount: Number(r.amount),
    currency: String(r.currency),
    channelId: String(r.channel),
    status: String(r.status),
    reviewVerdict: r.review_verdict ? String(r.review_verdict) : null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as Date).toISOString() : null,
    createdAt: new Date(r.created_at as Date).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at as Date).toISOString() : null,
    rejectReason: r.reject_reason ? String(r.reject_reason) : null,
  }))

  return { total, items }
}

// ── 首页板块手动干预（pin/exclude）配置 ──────────────────────────────────────

export const HOMEPAGE_SECTION_KEYS = [
  'popular', 'highRebate', 'newGames', 'slots', 'casino', 'perya', 'fishing', 'lottery', 'mythology', 'megaWin',
] as const

export interface HomepageSectionGameRow {
  sectionKey: string
  gameUuid: string
  action: 'pin' | 'exclude'
  pinPosition: number | null
  currency: string
  sortOrder: number
}

export async function listHomepageSectionGames(env: Env): Promise<HomepageSectionGameRow[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT section_key, game_uuid, action, pin_position, currency, sort_order
     FROM bg_homepage_section_game
     ORDER BY section_key ASC, currency ASC, sort_order ASC, id ASC`,
  )
  return rows.map((r) => ({
    sectionKey: String(r.section_key),
    gameUuid: String(r.game_uuid),
    action: r.action as 'pin' | 'exclude',
    pinPosition: r.pin_position == null ? null : Number(r.pin_position),
    currency: String(r.currency ?? ''),
    sortOrder: Number(r.sort_order ?? 0),
  }))
}

// 按 (板块, 币种) 整体替换：先删后插，sort_order 用数组下标。currency='' 表示全币种。
export async function replaceHomepageSectionGames(
  env: Env,
  sectionKey: string,
  currency: string,
  items: { gameUuid: string; action: 'pin' | 'exclude'; pinPosition: number | null }[],
): Promise<void> {
  if (!HOMEPAGE_SECTION_KEYS.includes(sectionKey as (typeof HOMEPAGE_SECTION_KEYS)[number])) {
    throw new Error(`unknown section_key: ${sectionKey}`)
  }
  const cur = currency === 'PHP' || currency === 'USDT' ? currency : ''
  const seen = new Set<string>()
  const conn = await pool(env).getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(`DELETE FROM bg_homepage_section_game WHERE section_key = ? AND currency = ?`, [sectionKey, cur])
    let i = 0
    for (const it of items) {
      if (!it.gameUuid || seen.has(it.gameUuid)) continue
      seen.add(it.gameUuid)
      const action = it.action === 'exclude' ? 'exclude' : 'pin'
      const pos = action === 'pin' && it.pinPosition != null ? Number(it.pinPosition) : null
      await conn.execute(
        `INSERT INTO bg_homepage_section_game (section_key, game_uuid, action, pin_position, currency, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sectionKey, it.gameUuid, action, pos, cur, i++],
      )
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}
