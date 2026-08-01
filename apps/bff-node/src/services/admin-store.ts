import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { getLevelThresholds, resolveLevel } from './rebate.service.js'
import { phpRateMap } from './marketing-bi.service.js'

export interface OrderSummary {
  php: number                                          // 全币种折 PHP 合计
  byCurrency: { currency: string; amount: number }[]   // 非 PHP 原币种金额（用于 PHP 后括号展示）
}

// 金额全币种折 PHP 合并 + 非 PHP 原币种明细：批量查一页用户，返回 user_id -> OrderSummary
async function orderSummaries(
  env: Env,
  redis: Redis,
  table: 'bg_deposit_order' | 'bg_withdraw_order',
  statusIn: string[],
  userIds: string[],
): Promise<Map<string, OrderSummary>> {
  const map = new Map<string, OrderSummary>()
  if (!userIds.length) return map
  const idPh = userIds.map(() => '?').join(',')
  const stPh = statusIn.map(() => '?').join(',')
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT user_id, currency AS cur, COALESCE(SUM(amount),0) AS amt
     FROM ${table}
     WHERE status IN (${stPh}) AND user_id IN (${idPh})
     GROUP BY user_id, currency`,
    [...statusIn, ...userIds],
  )
  const rates = await phpRateMap(redis, env, rows.map((r) => String(r.cur)))
  for (const r of rows) {
    const uid = String(r.user_id)
    const cur = String(r.cur)
    const amt = Number(r.amt)
    if (amt === 0) continue
    let s = map.get(uid)
    if (!s) { s = { php: 0, byCurrency: [] }; map.set(uid, s) }
    s.php += amt * (rates.get(cur) ?? 1)
    if (cur !== 'PHP') s.byCurrency.push({ currency: cur, amount: amt })
  }
  return map
}

// 累计充值（已支付订单，全币种折 PHP + 非 PHP 明细）
export function getUserDepositSummaries(env: Env, redis: Redis, userIds: string[]) {
  return orderSummaries(env, redis, 'bg_deposit_order', ['paid'], userIds)
}
// 累计取款（已完成订单，全币种折 PHP + 非 PHP 明细）
export function getUserWithdrawSummaries(env: Env, redis: Redis, userIds: string[]) {
  return orderSummaries(env, redis, 'bg_withdraw_order', ['completed'], userIds)
}

export const SMS_TEST_MODE_KEY = 'sms_test_mode'
const SMS_TEST_MODE_CACHE_KEY = 'admin:setting:sms_test_mode'
const SMS_TEST_MODE_CACHE_TTL_SEC = 300
export const MAINTENANCE_MODE_KEY = 'maintenance_mode'
const MAINTENANCE_MODE_CACHE_KEY = 'admin:setting:maintenance_mode'
// 缓存短 TTL：开关切换最迟 10s 生效，日常请求不打 DB
const MAINTENANCE_MODE_CACHE_TTL_SEC = 10

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
  }
}

// 折 PHP 支持的币种（其余按 1:1 计）
const FOLD_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TRX_TESTNET']

// 排序字段白名单 -> SQL 列（值来自后端固定映射，杜绝注入）
const USER_SORT_COLUMNS: Record<string, string> = {
  lastLoginAt: 'u.last_login_at',
  balance: 'available',
  depositAmount: 'deposit_php',
  withdrawAmount: 'withdraw_php',
  id: 'CAST(REGEXP_REPLACE(u.id, "[^0-9]", "") AS UNSIGNED)',
}

// 折 PHP 的 CASE 片段：币种->汇率来自 Redis 快照，数值直接内联（非用户输入，安全）
function phpFoldCase(rates: Map<string, number>): string {
  const whens = [...rates.entries()]
    .filter(([cur]) => cur !== 'PHP')
    .map(([cur, rate]) => `WHEN ${JSON.stringify(cur)} THEN ${Number(rate) || 0}`)
    .join(' ')
  return whens ? `CASE currency ${whens} ELSE 1 END` : '1'
}

export async function listAdminUsers(
  env: Env,
  redis: Redis,
  opts: {
    page: number; pageSize: number; search?: string; status?: string; channel?: string; platform?: string
    dateFrom?: string; dateTo?: string; minDeposit?: number; minWithdraw?: number
    sortBy?: string; sortOrder?: string
  },
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
  if (opts.platform) {
    conditions.push(`u.last_platform = ?`)
    params.push(opts.platform)
  }
  // 投放渠道筛选：organic=自然量(无归因记录)，其余精确匹配短码
  if (opts.channel === 'organic') {
    conditions.push(`attr.user_id IS NULL`)
  } else if (opts.channel) {
    conditions.push(`attr.channel_code = ?`)
    params.push(opts.channel)
  }
  // 注册日期范围（马尼拉日 -> UTC 半开区间）
  if (opts.dateFrom) {
    conditions.push(`u.registered_at >= ?`)
    params.push(new Date(`${opts.dateFrom}T00:00:00+08:00`))
  }
  if (opts.dateTo) {
    conditions.push(`u.registered_at < ?`)
    params.push(new Date(new Date(`${opts.dateTo}T00:00:00+08:00`).getTime() + 86400000))
  }

  // 充值/取款金额门槛需先算折 PHP 汇率快照，构造 SQL 内联 CASE
  const rates = await phpRateMap(redis, env, FOLD_CURRENCIES)
  const foldCase = phpFoldCase(rates)
  const depJoin = `LEFT JOIN (
       SELECT user_id, SUM(amount * (${foldCase})) AS php
       FROM bg_deposit_order WHERE status = 'paid' GROUP BY user_id
     ) dep ON dep.user_id = u.id`
  const wdJoin = `LEFT JOIN (
       SELECT user_id, SUM(amount * (${foldCase})) AS php
       FROM bg_withdraw_order WHERE status = 'completed' GROUP BY user_id
     ) wd ON wd.user_id = u.id`

  if (opts.minDeposit != null) {
    conditions.push(`COALESCE(dep.php,0) >= ?`)
    params.push(opts.minDeposit)
  }
  if (opts.minWithdraw != null) {
    conditions.push(`COALESCE(wd.php,0) >= ?`)
    params.push(opts.minWithdraw)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const attrJoin = `LEFT JOIN bg_user_attribution attr ON attr.user_id = u.id`
  const walletJoin = `LEFT JOIN bg_wallet w ON w.user_id = u.id AND w.currency = 'PHP'`
  const baseJoins = `${walletJoin} ${attrJoin} ${depJoin} ${wdJoin}`

  const sortCol = USER_SORT_COLUMNS[opts.sortBy ?? ''] ?? null
  const sortDir = opts.sortOrder === 'asc' ? 'ASC' : 'DESC'
  const orderBy = sortCol ? `ORDER BY ${sortCol} ${sortDir}` : `ORDER BY u.registered_at DESC`

  const [countRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM bg_user u ${baseJoins} ${where}`,
    params,
  )
  const total = Number(countRows[0]?.cnt ?? 0)

  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT u.id, u.display_name, u.email, u.status, u.label,
            u.last_login_at, u.last_login_region, u.last_platform, u.register_region, u.registered_at,
            COALESCE(w.available,0) as available, attr.channel_code,
            COALESCE(dep.php,0) AS deposit_php, COALESCE(wd.php,0) AS withdraw_php
     FROM bg_user u
     ${baseJoins}
     ${where}
     ${orderBy}
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
       WHERE is_reversed = 0 AND currency = 'PHP' AND user_id IN (${placeholders}) GROUP BY user_id`,
      ids,
    )
    const thresholds = await getLevelThresholds(env, 'PHP')
    for (const tr of tRows) levelMap.set(String(tr.user_id), resolveLevel(thresholds, Number(tr.total)))
  }

  // 充值/取款：折 PHP 总额 + 非 PHP 原币种明细（展示用；排序/筛选仍用 SQL 内的折 PHP 值）
  const [depSum, wdSum] = await Promise.all([
    getUserDepositSummaries(env, redis, ids),
    getUserWithdrawSummaries(env, redis, ids),
  ])

  const items = rows.map((r) => ({
    id: String(r.id),
    displayName: String(r.display_name),
    email: r.email ? String(r.email) : null,
    status: String(r.status),
    label: String(r.label ?? 'normal'),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at as Date).toISOString() : null,
    lastLoginRegion: r.last_login_region ? String(r.last_login_region) : null,
    lastPlatform: r.last_platform ? String(r.last_platform) : null,
    registerRegion: r.register_region ? String(r.register_region) : null,
    registeredAt: (() => { const d = new Date(r.registered_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    balance: Number(r.available),
    channelCode: r.channel_code ? String(r.channel_code) : null,
    level: levelMap.get(String(r.id)) ?? 1,
    depositAmount: Number(r.deposit_php),
    depositByCurrency: depSum.get(String(r.id))?.byCurrency ?? [],
    withdrawAmount: Number(r.withdraw_php),
    withdrawByCurrency: wdSum.get(String(r.id))?.byCurrency ?? [],
  }))

  return { total, items }
}

export async function listAdminDeposits(
  env: Env,
  opts: { page: number; pageSize: number; userId?: string; status?: string; dateFrom?: Date; dateTo?: Date },
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.userId) { conditions.push(`user_id = ?`); params.push(opts.userId) }
  if (opts.status) { conditions.push(`status = ?`); params.push(opts.status) }
  if (opts.dateFrom) { conditions.push(`created_at >= ?`); params.push(opts.dateFrom) }
  if (opts.dateTo) { conditions.push(`created_at <= ?`); params.push(opts.dateTo) }

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
): Promise<{ id: number; ip: string | null; region: string | null; userAgent: string | null; authMethod: string; entrySource: string | null; deviceId: string | null; fpVisitor: string | null; createdAt: string }[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT id, ip, region, user_agent, auth_method, entry_source, device_id, fp_visitor, created_at FROM bg_login_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    ip: r.ip ? String(r.ip) : null,
    region: r.region ? String(r.region) : null,
    userAgent: r.user_agent ? String(r.user_agent) : null,
    authMethod: String(r.auth_method),
    entrySource: r.entry_source ? String(r.entry_source) : null,
    deviceId: r.device_id ? String(r.device_id) : null,
    fpVisitor: r.fp_visitor ? String(r.fp_visitor) : null,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))
}

// 反查：一次输入同时匹配 IP / 设备ID / 指纹 / 账号(user_id)，找出所有关联账号及登录记录
export async function lookupLoginByValue(
  env: Env,
  value: string,
): Promise<{
  value: string
  accounts: { userId: string; displayName: string; status: string; loginCount: number; firstSeen: string; lastSeen: string }[]
  logs: { id: number; userId: string; ip: string | null; region: string | null; userAgent: string | null; authMethod: string; entrySource: string | null; deviceId: string | null; fpVisitor: string | null; createdAt: string }[]
}> {
  if (!value) return { value, accounts: [], logs: [] }
  const p = pool(env)
  const match = `(l.ip = ? OR l.device_id = ? OR l.fp_visitor = ? OR l.user_id = ?)`
  const args = [value, value, value, value]
  const [accRows] = await p.query<RowDataPacket[]>(
    `SELECT l.user_id, u.display_name, u.status,
            COUNT(*) AS login_count, MIN(l.created_at) AS first_seen, MAX(l.created_at) AS last_seen
     FROM bg_login_log l LEFT JOIN bg_user u ON u.id = l.user_id
     WHERE ${match}
     GROUP BY l.user_id, u.display_name, u.status ORDER BY last_seen DESC LIMIT 200`,
    args,
  )
  const [logRows] = await p.query<RowDataPacket[]>(
    `SELECT id, user_id, ip, region, user_agent, auth_method, entry_source, device_id, fp_visitor, created_at
     FROM bg_login_log l WHERE ${match} ORDER BY created_at DESC LIMIT 200`,
    args,
  )
  return {
    value,
    accounts: accRows.map((r) => ({
      userId: String(r.user_id),
      displayName: r.display_name ? String(r.display_name) : '',
      status: r.status ? String(r.status) : '',
      loginCount: Number(r.login_count),
      firstSeen: new Date(r.first_seen as Date).toISOString(),
      lastSeen: new Date(r.last_seen as Date).toISOString(),
    })),
    logs: logRows.map((r) => ({
      id: Number(r.id),
      userId: String(r.user_id),
      ip: r.ip ? String(r.ip) : null,
      region: r.region ? String(r.region) : null,
      userAgent: r.user_agent ? String(r.user_agent) : null,
      authMethod: String(r.auth_method),
      entrySource: r.entry_source ? String(r.entry_source) : null,
      deviceId: r.device_id ? String(r.device_id) : null,
      fpVisitor: r.fp_visitor ? String(r.fp_visitor) : null,
      createdAt: new Date(r.created_at as Date).toISOString(),
    })),
  }
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

export interface ProviderStat {
  provider: string
  providerShort: string | null
  weight: number
  total: number
  active: number
  rtps?: number[]
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

const VIRTUAL_SPORTSBOOK_UUID = '568win:sportsbook'
const VIRTUAL_SPORTSBOOK_PROVIDER = '568Win Sports'
const VIRTUAL_SPORTSBOOK_NAME = '568Win Sports'
const VIRTUAL_SPORTSBOOK_NAME_ZH = '568Win 体育'

type ListAdminWin568GamesOpts = {
  page: number; pageSize: number
  provider?: string | string[]; search?: string; isActive?: boolean; upstreamAvailable?: boolean
  sortCategory?: string; siteCategory?: string; newGameType?: number; currency?: string; device?: string
  gameProviderId?: number; gameId?: number
  isFeatured?: boolean; coverStatus?: string; sortField?: string; sortOrder?: 'asc' | 'desc'
}

async function getVirtualSportsbookRow(env: Env): Promise<RowDataPacket | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT uuid, provider, name, name_zh, category, sort_category, site_category,
            is_active, weight, is_featured, image_override, image_source, supported_currencies,
            created_at, updated_at
     FROM bg_virtual_game_config WHERE uuid = ? LIMIT 1`,
    [VIRTUAL_SPORTSBOOK_UUID],
  )
  return rows[0] ?? null
}

function mapVirtualSportsbook(row: RowDataPacket | null) {
  const imageUrl = row?.image_override ? String(row.image_override) : null
  const supportedCurrencies = parseJsonValue(row?.supported_currencies) ?? ['PHP', 'USDT']
  const localActive = row?.is_active == null ? true : Boolean(row.is_active)
  const updatedAt = row?.updated_at ? new Date(row.updated_at as Date) : null
  return {
    uuid: VIRTUAL_SPORTSBOOK_UUID,
    gameId: 0,
    gameProviderId: 0,
    provider: row?.provider ? String(row.provider) : VIRTUAL_SPORTSBOOK_PROVIDER,
    providerShort: 'SPORTS',
    name: row?.name ? String(row.name) : VIRTUAL_SPORTSBOOK_NAME,
    nameEn: row?.name ? String(row.name) : VIRTUAL_SPORTSBOOK_NAME,
    nameZh: row?.name_zh ? String(row.name_zh) : VIRTUAL_SPORTSBOOK_NAME_ZH,
    nameOverride: row?.name ? String(row.name) : null,
    imageUrl,
    iconUrl: null,
    iconWidth: null,
    iconHeight: null,
    iconProbedAt: null,
    coverStatus: imageUrl ? 'square' : 'none',
    imageOverride: imageUrl,
    newGameType: 300,
    gameType: null,
    sortCategory: row?.sort_category ? String(row.sort_category) : 'sports',
    overrideSortCategory: row?.sort_category ? String(row.sort_category) : null,
    siteCategory: row?.site_category ? String(row.site_category) : 'sports',
    siteCategoryAuto: 'sports',
    overrideSiteCategory: row?.site_category ? String(row.site_category) : null,
    rankNo: null,
    device: 'd,m',
    platform: 'HTML5',
    rtp: null,
    rowsCount: null,
    reelsCount: null,
    linesCount: null,
    supportedCurrencies,
    blockCountries: null,
    upstreamAvailable: true,
    localActive,
    isActive: localActive,
    isEnabled: true,
    isMaintain: false,
    providerStatus: 'Online',
    isProviderOnline: true,
    isProvideCommission: false,
    hasHedgeBet: false,
    weight: row?.weight == null ? 10000 : Number(row.weight),
    overrideWeight: row?.weight == null ? null : Number(row.weight),
    weightBreakdown: null,
    weightUpdatedAt: null,
    isFeatured: row?.is_featured == null ? true : Boolean(row.is_featured),
    overrideFeatured: row?.is_featured == null ? null : Boolean(row.is_featured),
    overrideActive: localActive,
    syncedAt: null,
    updatedAt: updatedAt && !isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : null,
  }
}

function arrayValue(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function virtualSportsbookMatches(item: ReturnType<typeof mapVirtualSportsbook>, opts: ListAdminWin568GamesOpts): boolean {
  if (opts.gameProviderId !== undefined && opts.gameProviderId !== 0) return false
  if (opts.gameId !== undefined && opts.gameId !== 0) return false
  const providers = arrayValue(opts.provider)
  if (providers.length && !providers.includes(item.provider)) return false
  if (opts.search) {
    const s = opts.search.toLowerCase()
    const haystack = [item.name, item.nameZh, item.provider, item.uuid, String(item.gameId), String(item.gameProviderId)].filter(Boolean).join(' ').toLowerCase()
    if (!haystack.includes(s)) return false
  }
  if (opts.isActive !== undefined && item.localActive !== opts.isActive) return false
  if (opts.upstreamAvailable !== undefined && item.upstreamAvailable !== opts.upstreamAvailable) return false
  if (opts.sortCategory && item.sortCategory !== opts.sortCategory) return false
  if (opts.siteCategory && item.siteCategory !== opts.siteCategory) return false
  if (opts.newGameType !== undefined && item.newGameType !== opts.newGameType) return false
  if (opts.currency) {
    const currency = opts.currency.toUpperCase()
    const supported = Array.isArray(item.supportedCurrencies) ? item.supportedCurrencies.map(String) : []
    const aliases = currency === 'USDT' || currency === 'UCC' ? ['USDT', 'UCC', 'USD', 'USDC'] : [currency]
    if (supported.length && !supported.some((c) => aliases.includes(c))) return false
  }
  if (opts.device && !String(item.device).split(/[,/]/).map((s) => s.trim()).includes(opts.device)) return false
  if (opts.isFeatured !== undefined && item.isFeatured !== opts.isFeatured) return false
  if (opts.coverStatus && item.coverStatus !== opts.coverStatus) return false
  return true
}

export async function listAdminWin568Games(
  env: Env,
  opts: ListAdminWin568GamesOpts,
) {
  const offset = (opts.page - 1) * opts.pageSize
  const conditions: string[] = []
  const params: unknown[] = []
  const sortCategory = win568SortCategoryExpr()
  const upstreamAvailable = win568UpstreamAvailableExpr()
  const localActive = win568LocalActiveExpr()
  const virtualSportsbook = mapVirtualSportsbook(await getVirtualSportsbookRow(env))
  const includeVirtualSportsbook = virtualSportsbookMatches(virtualSportsbook, opts)

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
    conditions.push('(g.name_en LIKE ? OR g.name_zh LIKE ? OR o.name_override LIKE ? OR g.provider LIKE ? OR CAST(g.game_id AS CHAR) LIKE ? OR CAST(g.game_provider_id AS CHAR) LIKE ?)')
    params.push(`%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`)
  }
  if (opts.isActive !== undefined) conditions.push(`${localActive} = ${opts.isActive ? 1 : 0}`)
  if (opts.upstreamAvailable !== undefined) conditions.push(`${upstreamAvailable} = ${opts.upstreamAvailable ? 1 : 0}`)
  if (opts.sortCategory) { conditions.push(`${sortCategory} = ?`); params.push(opts.sortCategory) }
  if (opts.siteCategory) { conditions.push(`COALESCE(o.site_category, g.site_category_auto, 'other') = ?`); params.push(opts.siteCategory) }
  if (opts.newGameType !== undefined) { conditions.push('g.new_game_type = ?'); params.push(opts.newGameType) }
  if (opts.currency) {
    const currency = opts.currency.toUpperCase()
    if (currency === 'USDT' || currency === 'UCC') {
      // USD/USDC 视同 USDT(UCC)：与前台开放口径一致
      conditions.push(`(g.supported_currencies IS NULL OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('USDT')) OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('UCC')) OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('USD')) OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('USDC')))`)
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
  const realTotal = Number(countRows[0]?.cnt ?? 0)
  const total = realTotal + (includeVirtualSportsbook ? 1 : 0)

  const allowedSortFields: Record<string, string> = {
    weight: 'effective_weight',
    rank: 'g.rank_no',
    gameId: 'g.game_id',
    providerId: 'g.game_provider_id',
  }
  const sortCol = (opts.sortField && allowedSortFields[opts.sortField]) || 'effective_weight'
  const sortDir = opts.sortOrder === 'asc' ? 'ASC' : 'DESC'
  const virtualFirst = includeVirtualSportsbook
  const realLimit = virtualFirst && offset === 0 ? Math.max(0, opts.pageSize - 1) : opts.pageSize
  const realOffset = virtualFirst && offset > 0 ? Math.max(0, offset - 1) : offset

  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT g.game_id, g.game_provider_id, g.provider, g.provider_short, g.new_game_type, g.game_type, g.rank_no,
            g.device, g.platform, g.rtp, g.rows_count, g.reels_count, g.lines_count,
            g.name_en, g.name_zh, g.icon_url, g.icon_width, g.icon_height, g.icon_probed_at,
            g.supported_currencies, g.block_countries,
            g.is_enabled, g.is_maintain, g.provider_status, g.is_provider_online,
            g.is_provide_commission, g.has_hedge_bet, g.synced_at, g.updated_at,
            o.is_active AS override_active, o.weight AS override_weight,
            o.is_featured AS override_featured, o.sort_category AS override_sort_category,
            o.site_category AS override_site_category, g.site_category_auto,
            COALESCE(o.site_category, g.site_category_auto, 'other') AS effective_site_category,
            o.name_override, o.image_override, o.weight_breakdown, o.weight_updated_at,
            ${sortCategory} AS effective_sort_category,
            ${upstreamAvailable} AS upstream_available,
            ${localActive} AS local_active,
            -- 与 sg-game.service 缓存查询同公式：rank兜底封顶3998，低于手工层(>=4000)
            COALESCE(o.weight, GREATEST(1, 3999 - COALESCE(g.rank_no, 9999))) AS effective_weight,
            COALESCE(o.is_featured, 0) AS effective_featured,
            COALESCE(o.name_override, g.name_en, g.name_zh, CONCAT('568Win ', g.game_id)) AS effective_name,
            COALESCE(o.image_override, g.icon_url) AS effective_image
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     ${where}
     ORDER BY ${sortCol} ${sortDir}, g.provider, effective_name
     LIMIT ? OFFSET ?`,
    [...params, realLimit, realOffset],
  )
  const [provRows] = await pool(env).query<RowDataPacket[]>(
    `SELECT DISTINCT provider FROM bg_568win_game ORDER BY provider`,
  )

  const items = rows.map((r) => ({
    uuid: `568win:${String(r.game_provider_id)}:${String(r.game_id)}`,
    gameId: Number(r.game_id),
    gameProviderId: Number(r.game_provider_id),
    provider: r.provider ? String(r.provider) : '568Win',
    providerShort: r.provider_short ? String(r.provider_short) : null,
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
    weightBreakdown: parseJsonValue(r.weight_breakdown),
    weightUpdatedAt: (() => { const d = new Date(r.weight_updated_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    isFeatured: Boolean(r.effective_featured),
    overrideFeatured: r.override_featured == null ? null : Boolean(r.override_featured),
    overrideActive: r.override_active == null ? null : Boolean(r.override_active),
    syncedAt: (() => { const d = new Date(r.synced_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
    updatedAt: (() => { const d = new Date(r.updated_at as Date); return isNaN(d.getTime()) ? null : d.toISOString() })(),
  }))

  const pagedItems = virtualFirst && offset === 0 ? [virtualSportsbook, ...items] : items
  const providers = [...new Set([...provRows.map((r) => String(r.provider)), virtualSportsbook.provider])].sort((a, b) => a.localeCompare(b))
  return { total, items: pagedItems, providers }
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
  if (gameProviderId === 0 && gameId === 0) {
    const current = await getVirtualSportsbookRow(env)
    await pool(env).execute(
      `INSERT INTO bg_virtual_game_config
       (uuid, provider, name, name_zh, category, sort_category, site_category, is_active, weight, is_featured,
        image_override, image_source, supported_currencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY('PHP', 'USDT'))
       ON DUPLICATE KEY UPDATE
         provider = VALUES(provider),
         name = VALUES(name),
         name_zh = VALUES(name_zh),
         category = VALUES(category),
         sort_category = VALUES(sort_category),
         site_category = VALUES(site_category),
         is_active = VALUES(is_active),
         weight = VALUES(weight),
         is_featured = VALUES(is_featured),
         image_override = VALUES(image_override),
         image_source = VALUES(image_source)`,
      [
        VIRTUAL_SPORTSBOOK_UUID,
        current?.provider ? String(current.provider) : VIRTUAL_SPORTSBOOK_PROVIDER,
        patch.nameOverride === undefined ? (current?.name ? String(current.name) : VIRTUAL_SPORTSBOOK_NAME) : (patch.nameOverride || VIRTUAL_SPORTSBOOK_NAME),
        current?.name_zh ? String(current.name_zh) : VIRTUAL_SPORTSBOOK_NAME_ZH,
        current?.category ? String(current.category) : 'sportsbook',
        patch.sortCategory === undefined ? (current?.sort_category ? String(current.sort_category) : 'sports') : (patch.sortCategory || 'sports'),
        patch.siteCategory === undefined ? (current?.site_category ? String(current.site_category) : 'sports') : (patch.siteCategory || 'sports'),
        patch.isActive === undefined ? (current?.is_active == null ? 1 : Number(Boolean(current.is_active))) : Number(Boolean(patch.isActive)),
        patch.weight === undefined ? (current?.weight == null ? 10000 : Number(current.weight)) : (patch.weight ?? 10000),
        patch.isFeatured === undefined ? (current?.is_featured == null ? 1 : Number(Boolean(current.is_featured))) : Number(Boolean(patch.isFeatured)),
        patch.imageOverride === undefined ? (current?.image_override ? String(current.image_override) : null) : patch.imageOverride,
        patch.imageOverrideSource === undefined ? (current?.image_source ? String(current.image_source) : null) : patch.imageOverrideSource,
      ],
    )
    return
  }

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
): Promise<{
  candidates: { source: string; url: string; animUrl: string | null }[]
  currentSource: string
  currentUrl: string
}> {
  if (gameProviderId === 0 && gameId === 0) {
    const row = await getVirtualSportsbookRow(env)
    const [rows] = await pool(env).query<RowDataPacket[]>(
      `SELECT provider, icon_url FROM bg_568win_game
       WHERE new_game_type = 300 AND icon_url IS NOT NULL AND icon_url <> ''
       GROUP BY provider, icon_url
       ORDER BY provider, icon_url`,
    )
    const seen = new Set<string>()
    const candidates = rows
      .map((r) => ({ source: String(r.provider || '568win'), url: String(r.icon_url), animUrl: null }))
      .filter((c) => {
        if (seen.has(c.url)) return false
        seen.add(c.url)
        return true
      })
    const currentUrl = row?.image_override ? String(row.image_override) : ''
    return { candidates, currentSource: row?.image_source ? String(row.image_source) : 'manual', currentUrl }
  }

  const [[g]] = await pool(env).query<RowDataPacket[]>(
    `SELECT g.icon_url, o.image_override, o.image_override_source
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     WHERE g.game_provider_id = ? AND g.game_id = ? LIMIT 1`,
    [gameProviderId, gameId],
  )
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT source, url, anim_url FROM bg_568win_game_cover_candidate
     WHERE game_provider_id = ? AND game_id = ? ORDER BY FIELD(source,'playtime','fbmplay','bingoplus','casinoplus','gzone'), source`,
    [gameProviderId, gameId],
  )
  const candidates = rows.map((r) => ({ source: String(r.source), url: String(r.url), animUrl: r.anim_url ? String(r.anim_url) : null }))
  const iconUrl = g?.icon_url ? String(g.icon_url) : ''
  // 568win 上游原图作为兜底候选（放最后）
  if (iconUrl) candidates.push({ source: '568win', url: iconUrl, animUrl: null })

  // 当前实际生效的封面：与 loadGamesCache 的 COALESCE 优先级一致
  // 手动override > playtime > fbmplay > bingoplus > 568win 上游原图
  let currentSource = '568win', currentUrl = iconUrl
  if (g?.image_override) {
    currentSource = String(g.image_override_source || 'manual'); currentUrl = String(g.image_override)
  } else {
    for (const s of ['playtime', 'fbmplay', 'bingoplus']) {
      const hit = candidates.find((c) => c.source === s)
      if (hit) { currentSource = hit.source; currentUrl = hit.url; break }
    }
  }
  return { candidates, currentSource, currentUrl }
}

export async function toggleAdminWin568Game(env: Env, gameProviderId: number, gameId: number, isActive: boolean): Promise<void> {
  await updateAdminWin568Game(env, gameProviderId, gameId, { isActive })
}

export async function getWin568ProviderStats(env: Env): Promise<ProviderStat[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT g.provider,
            MAX(g.provider_short) AS provider_short,
            COALESCE(MAX(p.weight), 1000) AS provider_weight,
            COUNT(*) AS total,
            SUM(CASE WHEN ${win568UpstreamAvailableExpr()} AND ${win568LocalActiveExpr()} THEN 1 ELSE 0 END) AS active,
            JSON_ARRAYAGG(CASE WHEN g.rtp IS NOT NULL AND g.rtp > 0 THEN g.rtp ELSE NULL END) AS rtps
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     LEFT JOIN bg_568win_provider p ON p.provider = g.provider
     GROUP BY g.provider
     ORDER BY provider_weight DESC, g.provider ASC`,
  )
  return rows.map((r) => ({
    provider: String(r.provider),
    providerShort: r.provider_short ? String(r.provider_short) : null,
    weight: Number(r.provider_weight),
    total: Number(r.total),
    active: Number(r.active),
    rtps: [...new Set((parseJsonValue(r.rtps) as unknown[] | null ?? [])
      .filter((v) => v !== null)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v)))]
      .sort((a, b) => a - b),
  }))
}

export async function setWin568ProviderWeight(env: Env, provider: string, weight: number): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_568win_provider (provider, weight) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE weight = VALUES(weight)`,
    [provider, weight],
  )
}

export async function toggleWin568ProviderGames(env: Env, provider: string, isActive: boolean): Promise<number> {
  await pool(env).execute(
    `INSERT INTO bg_568win_game_override (game_provider_id, game_id, is_active)
     SELECT game_provider_id, game_id, ? FROM bg_568win_game WHERE provider = ?
     ON DUPLICATE KEY UPDATE is_active = VALUES(is_active)`,
    [isActive ? 1 : 0, provider],
  )
  // affectedRows 在 ON DUPLICATE 下不等于游戏数(插1/改2/不变0)，单独数一次
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM bg_568win_game WHERE provider = ?`,
    [provider],
  )
  return Number(rows[0]?.cnt ?? 0)
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

export async function getMaintenanceMode(redis: Redis, env: Env): Promise<boolean> {
  try {
    const cached = await redis.get(MAINTENANCE_MODE_CACHE_KEY)
    if (cached === '1') return true
    if (cached === '0') return false
    const raw = await getAdminSetting(env, MAINTENANCE_MODE_KEY)
    const enabled = raw === '1'
    await redis.set(MAINTENANCE_MODE_CACHE_KEY, enabled ? '1' : '0', 'EX', MAINTENANCE_MODE_CACHE_TTL_SEC)
    return enabled
  } catch {
    // 维护开关探测失败不能把全站打成 503
    return false
  }
}

export async function setMaintenanceMode(redis: Redis, env: Env, enabled: boolean): Promise<void> {
  await setAdminSetting(env, MAINTENANCE_MODE_KEY, enabled ? '1' : '0')
  await redis.set(MAINTENANCE_MODE_CACHE_KEY, enabled ? '1' : '0', 'EX', MAINTENANCE_MODE_CACHE_TTL_SEC)
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
    completedAt: r.handled_at ? new Date(r.handled_at as Date).toISOString() : null,
    rejectReason: r.reject_reason ? String(r.reject_reason) : null,
  }))

  return { total, items }
}

// ── Games 页分类 All 列表手动置顶排序 ────────────────────────────────────────

export const CATEGORY_SORT_KEYS = [
  'all', 'slot', 'casino', 'perya', 'poker', 'fishing', 'sports', 'lottery', 'other',
] as const

export interface CategorySortGameRow {
  categoryKey: string
  gameUuid: string
  position: number
}

export async function listCategorySortGames(env: Env): Promise<CategorySortGameRow[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT category_key, game_uuid, position
     FROM bg_category_sort_game
     ORDER BY category_key ASC, position ASC, id ASC`,
  )
  return rows.map((r) => ({
    categoryKey: String(r.category_key),
    gameUuid: String(r.game_uuid),
    position: Number(r.position ?? 0),
  }))
}

// 按分类整体替换置顶列表：先删后插，position 用数组下标
export async function replaceCategorySortGames(
  env: Env,
  categoryKey: string,
  gameUuids: string[],
): Promise<void> {
  if (!CATEGORY_SORT_KEYS.includes(categoryKey as (typeof CATEGORY_SORT_KEYS)[number])) {
    throw new Error(`unknown category_key: ${categoryKey}`)
  }
  const seen = new Set<string>()
  const conn = await pool(env).getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(`DELETE FROM bg_category_sort_game WHERE category_key = ?`, [categoryKey])
    let i = 0
    for (const uuid of gameUuids) {
      if (!uuid || seen.has(uuid)) continue
      seen.add(uuid)
      await conn.execute(
        `INSERT INTO bg_category_sort_game (category_key, game_uuid, position) VALUES (?, ?, ?)`,
        [categoryKey, uuid, i++],
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

// ── 首页板块手动干预（pin/exclude）配置 ──────────────────────────────────────

export const HOMEPAGE_SECTION_KEYS = [
  'popular', 'recommended', 'newGames', 'slots', 'casino', 'perya', 'fishing', 'lottery', 'baccarat', 'highRtp', 'highRebate', 'sports',
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

// ── 首页板块「冻结名单」(popular/recommended/highRebate) ──────────────────────
export const FREEZABLE_SECTION_KEYS = ['popular', 'recommended', 'highRebate'] as const

// 按 (板块, 币种) 整体写入冻结名单：先删后插，sort_order 用数组下标。currency 必须 PHP|USDT。
export async function replaceFrozenBoard(
  env: Env,
  sectionKey: string,
  currency: string,
  uuids: string[],
): Promise<void> {
  if (!FREEZABLE_SECTION_KEYS.includes(sectionKey as (typeof FREEZABLE_SECTION_KEYS)[number])) {
    throw new Error(`section not freezable: ${sectionKey}`)
  }
  const cur = currency === 'PHP' || currency === 'USDT' ? currency : ''
  if (!cur) throw new Error('frozen board requires currency PHP|USDT')
  const seen = new Set<string>()
  const conn = await pool(env).getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(`DELETE FROM bg_homepage_frozen_board WHERE section_key = ? AND currency = ?`, [sectionKey, cur])
    let i = 0
    for (const u of uuids) {
      if (!u || seen.has(u)) continue
      seen.add(u)
      await conn.execute(
        `INSERT INTO bg_homepage_frozen_board (section_key, currency, game_uuid, sort_order) VALUES (?, ?, ?, ?)`,
        [sectionKey, cur, u, i++],
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

// 解冻：删除该 (板块,币种) 冻结名单，回到算法
export async function deleteFrozenBoard(env: Env, sectionKey: string, currency: string): Promise<void> {
  const cur = currency === 'PHP' || currency === 'USDT' ? currency : ''
  await pool(env).execute(`DELETE FROM bg_homepage_frozen_board WHERE section_key = ? AND currency = ?`, [sectionKey, cur])
}

// 冻结状态：各 (可冻结板块,币种) 是否已冻结 + 条数（后台展示用）
export async function listFrozenBoardStatus(env: Env): Promise<{ sectionKey: string; currency: string; count: number }[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT section_key, currency, COUNT(*) AS cnt FROM bg_homepage_frozen_board GROUP BY section_key, currency`,
  )
  return rows.map((r) => ({ sectionKey: String(r.section_key), currency: String(r.currency), count: Number(r.cnt) }))
}

// ── 首页板块显示/隐藏 ────────────────────────────────────────────────────────

// 已隐藏的 (板块,币种)。无行 或 hidden=0 视为显示。
export async function listHiddenSections(env: Env): Promise<{ sectionKey: string; currency: string }[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT section_key, currency FROM bg_homepage_section_visibility WHERE hidden = 1`,
  )
  return rows.map((r) => ({ sectionKey: String(r.section_key), currency: String(r.currency) }))
}

export async function setSectionVisibility(env: Env, sectionKey: string, currency: string, hidden: boolean): Promise<void> {
  if (!HOMEPAGE_SECTION_KEYS.includes(sectionKey as (typeof HOMEPAGE_SECTION_KEYS)[number])) {
    throw new Error(`unknown section_key: ${sectionKey}`)
  }
  if (currency !== 'PHP' && currency !== 'USDT') throw new Error('currency 必须为 PHP 或 USDT')
  await pool(env).execute(
    `INSERT INTO bg_homepage_section_visibility (section_key, currency, hidden) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE hidden = VALUES(hidden)`,
    [sectionKey, currency, hidden ? 1 : 0],
  )
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
