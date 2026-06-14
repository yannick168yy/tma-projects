import type { Pool, RowDataPacket } from 'mysql2/promise'
import type {
  OrderDeposit,
  OrderWithdraw,
  KycSubmission,
  LedgerEntry,
  UserRecord,
  WalletRecord,
  WalletBalance,
} from '../../types/domain.js'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { generateInviteCode } from '../../utils/id.js'
import { nowIso } from '../../utils/format.js'

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

function defaultProfile(): UserRecord['profile'] {
  return {
    firstName: '',
    lastName: '',
    gender: '',
    dobMonth: '',
    dobDay: '',
    dobYear: '',
  }
}

type UserRow = RowDataPacket & {
  id: string
  telegram_user_id: number | null
  telegram_username: string | null
  telegram_oidc_sub: string | null
  google_sub: string | null
  username: string | null
  password_hash: string | null
  phone_account: string | null
  email: string | null
  display_name: string
  avatar_url: string | null
  invite_code: string
  inviter_id: string | null
  locale: string
  status: UserRecord['status']
  status_reason: string | null
  label: string
  last_login_at: Date | null
  last_login_ip: string | null
  last_login_region: string | null
  register_ip: string | null
  register_region: string | null
  registered_at: Date
  first_name: string
  last_name: string
  gender: string
  dob_month: string
  dob_day: string
  dob_year: string
  phone: string | null
  trial_claimed: number
  referral_claimed: number
  first_dep_claimed: number
  referral_ready: number
  first_dep_ready: number
  referral_milestone_met: number
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id ?? undefined,
    telegramUsername: row.telegram_username ?? undefined,
    telegramOidcSub: row.telegram_oidc_sub ?? undefined,
    googleSub: row.google_sub ?? undefined,
    username: row.username ?? undefined,
    passwordHash: row.password_hash ?? undefined,
    phoneAccount: row.phone_account ?? undefined,
    email: row.email ?? undefined,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    inviteCode: row.invite_code,
    referredBy: row.inviter_id ?? undefined,
    locale: row.locale as UserRecord['locale'],
    status: row.status,
    statusReason: row.status_reason ?? undefined,
    label: row.label ?? 'normal',
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : undefined,
    lastLoginIp: row.last_login_ip ?? undefined,
    lastLoginRegion: row.last_login_region ?? undefined,
    registerIp: row.register_ip ?? undefined,
    registerRegion: row.register_region ?? undefined,
    registeredAt: new Date(row.registered_at).toISOString(),
    profile: {
      firstName: row.first_name,
      lastName: row.last_name,
      gender: (row.gender || '') as UserRecord['profile']['gender'],
      dobMonth: row.dob_month,
      dobDay: row.dob_day,
      dobYear: row.dob_year,
      phone: row.phone ?? undefined,
      email: row.email ?? undefined,
    },
    trialClaimed: Boolean(row.trial_claimed),
    referralClaimed: Boolean(row.referral_claimed),
    firstDepClaimed: Boolean(row.first_dep_claimed),
    referralReady: Boolean(row.referral_ready),
    firstDepReady: Boolean(row.first_dep_ready),
    referralMilestoneMet: Boolean(row.referral_milestone_met),
  }
}

const USER_SELECT = `
  SELECT u.*, p.first_name, p.last_name, p.gender, p.dob_month, p.dob_day, p.dob_year, p.phone,
    ps.trial_claimed, ps.referral_claimed, ps.first_dep_claimed, ps.referral_ready,
    ps.first_dep_ready, ps.referral_milestone_met
  FROM bg_user u
  JOIN bg_user_profile p ON p.user_id = u.id
  JOIN bg_user_promo_state ps ON ps.user_id = u.id
`

async function nextUserId(env: Env): Promise<string> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)), 10000) + 1 AS n FROM bg_user`,
  )
  const n = Number(rows[0]?.n ?? 10001)
  return `BG-${n}`
}

export async function saveUser(env: Env, user: UserRecord): Promise<void> {
  const conn = await pool(env).getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      `INSERT INTO bg_user (id, telegram_user_id, telegram_username, telegram_oidc_sub, google_sub, username, password_hash, phone_account, email, display_name, avatar_url, invite_code, inviter_id, locale, status, status_reason, label, register_ip, register_region, registered_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         telegram_user_id=COALESCE(VALUES(telegram_user_id), telegram_user_id),
         telegram_oidc_sub=COALESCE(VALUES(telegram_oidc_sub), telegram_oidc_sub),
         google_sub=COALESCE(VALUES(google_sub), google_sub),
         telegram_username=VALUES(telegram_username),
         username=COALESCE(VALUES(username), username),
         password_hash=COALESCE(VALUES(password_hash), password_hash),
         phone_account=COALESCE(VALUES(phone_account), phone_account),
         display_name=VALUES(display_name), avatar_url=VALUES(avatar_url), email=VALUES(email),
         locale=VALUES(locale), status=VALUES(status), status_reason=VALUES(status_reason),
         label=VALUES(label)`,
      [
        user.id,
        user.telegramUserId ?? null,
        user.telegramUsername ?? null,
        user.telegramOidcSub ?? null,
        user.googleSub ?? null,
        user.username ?? null,
        user.passwordHash ?? null,
        user.phoneAccount ?? null,
        user.email ?? null,
        user.displayName,
        user.avatarUrl ?? null,
        user.inviteCode,
        user.referredBy ?? null,
        user.locale,
        user.status,
        user.statusReason ?? null,
        user.label ?? 'normal',
        user.registerIp ?? null,
        user.registerRegion ?? null,
        new Date(user.registeredAt),
      ],
    )
    await conn.execute(
      `INSERT INTO bg_user_profile (user_id, first_name, last_name, gender, dob_month, dob_day, dob_year, phone)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE first_name=VALUES(first_name), last_name=VALUES(last_name),
         gender=VALUES(gender), dob_month=VALUES(dob_month), dob_day=VALUES(dob_day), dob_year=VALUES(dob_year), phone=VALUES(phone)`,
      [
        user.id,
        user.profile.firstName,
        user.profile.lastName,
        user.profile.gender || '',
        user.profile.dobMonth,
        user.profile.dobDay,
        user.profile.dobYear,
        user.profile.phone ?? null,
      ],
    )
    await conn.execute(
      `INSERT INTO bg_user_promo_state (user_id, trial_claimed, referral_claimed, first_dep_claimed, referral_ready, first_dep_ready, referral_milestone_met)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE trial_claimed=VALUES(trial_claimed), referral_claimed=VALUES(referral_claimed),
         first_dep_claimed=VALUES(first_dep_claimed), referral_ready=VALUES(referral_ready),
         first_dep_ready=VALUES(first_dep_ready), referral_milestone_met=VALUES(referral_milestone_met)`,
      [
        user.id,
        user.trialClaimed ? 1 : 0,
        user.referralClaimed ? 1 : 0,
        user.firstDepClaimed ? 1 : 0,
        user.referralReady ? 1 : 0,
        user.firstDepReady ? 1 : 0,
        user.referralMilestoneMet ? 1 : 0,
      ],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

export async function getUser(env: Env, userId: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.id = ?`, [userId])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function getUserByTelegramId(env: Env, tgId: number): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.telegram_user_id = ?`, [tgId])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function getUserByTelegramOidcSub(env: Env, sub: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.telegram_oidc_sub = ?`, [sub])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function getUserByGoogleSub(env: Env, sub: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.google_sub = ?`, [sub])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function getUserByEmail(env: Env, email: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.email = ?`, [email])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function getUserByInviteCode(env: Env, code: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.invite_code = ?`, [
    code.toUpperCase(),
  ])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function getUserByUsername(env: Env, username: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.username = ?`, [username])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function getUserByPhoneAccount(env: Env, phone: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.phone_account = ?`, [phone])
  return rows[0] ? mapUser(rows[0]) : null
}

async function createUser(
  env: Env,
  base: Omit<UserRecord, 'id' | 'inviteCode' | 'registeredAt'>,
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  const id = await nextUserId(env)
  let inviteCode = generateInviteCode()
  while (await getUserByInviteCode(env, inviteCode)) {
    inviteCode = generateInviteCode()
  }
  const user: UserRecord = {
    ...base,
    id,
    inviteCode,
    registeredAt: nowIso(),
  }
  const conn = await pool(env).getConnection()
  try {
    await conn.beginTransaction()
    await saveUser(env, user)
    await conn.execute(
      `INSERT INTO bg_wallet (user_id, currency, available, frozen) VALUES (?, 'PHP', 0, 0)
       ON DUPLICATE KEY UPDATE user_id=user_id`,
      [id],
    )
    // 写入三级归属树（bg_user 已在 saveUser 事务中提交，此处可 JOIN）
    await conn.execute(
      `INSERT IGNORE INTO bg_team_node (user_id, l1_referrer_id, l2_referrer_id, l3_referrer_id)
       SELECT ?, u.inviter_id, l1.inviter_id, l2.inviter_id
       FROM bg_user u
       LEFT JOIN bg_user l1 ON l1.id = u.inviter_id
       LEFT JOIN bg_user l2 ON l2.id = l1.inviter_id
       WHERE u.id = ?`,
      [id, id],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return { user, isNewUser: true }
}

export async function createUserFromTelegram(
  env: Env,
  input: {
    telegramUserId: number
    displayName: string
    avatarUrl?: string
    telegramUsername?: string
    referredBy?: string
    registerIp?: string
    registerRegion?: string
  },
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  const existing = await getUserByTelegramId(env, input.telegramUserId)
  if (existing) {
    existing.displayName = input.displayName
    if (input.avatarUrl) existing.avatarUrl = input.avatarUrl
    if (input.telegramUsername) existing.telegramUsername = input.telegramUsername
    await saveUser(env, existing)
    return { user: existing, isNewUser: false }
  }
  return createUser(env, {
    telegramUserId: input.telegramUserId,
    telegramUsername: input.telegramUsername,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    referredBy: input.referredBy,
    registerIp: input.registerIp,
    registerRegion: input.registerRegion,
    locale: 'en',
    status: 'active',
    profile: defaultProfile(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  })
}

export async function createUserFromTelegramOidc(
  env: Env,
  input: {
    telegramOidcSub: string
    telegramUsername?: string
    displayName: string
    avatarUrl?: string
    referredBy?: string
    registerIp?: string
    registerRegion?: string
  },
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  const existing = await getUserByTelegramOidcSub(env, input.telegramOidcSub)
  if (existing) {
    existing.displayName = input.displayName
    if (input.avatarUrl) existing.avatarUrl = input.avatarUrl
    if (input.telegramUsername) existing.telegramUsername = input.telegramUsername
    await saveUser(env, existing)
    return { user: existing, isNewUser: false }
  }
  return createUser(env, {
    telegramOidcSub: input.telegramOidcSub,
    telegramUsername: input.telegramUsername,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    referredBy: input.referredBy,
    registerIp: input.registerIp,
    registerRegion: input.registerRegion,
    locale: 'en',
    status: 'active',
    profile: defaultProfile(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  })
}

export async function createUserFromGoogle(
  env: Env,
  input: {
    googleSub: string
    email?: string
    displayName: string
    avatarUrl?: string
    referredBy?: string
    registerIp?: string
    registerRegion?: string
  },
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  const existing = await getUserByGoogleSub(env, input.googleSub)
  if (existing) {
    existing.displayName = input.displayName
    if (input.avatarUrl) existing.avatarUrl = input.avatarUrl
    if (input.email) {
      existing.email = input.email
      existing.profile.email = input.email
    }
    await saveUser(env, existing)
    return { user: existing, isNewUser: false }
  }
  return createUser(env, {
    googleSub: input.googleSub,
    email: input.email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    referredBy: input.referredBy,
    registerIp: input.registerIp,
    registerRegion: input.registerRegion,
    locale: 'en',
    status: 'active',
    profile: { ...defaultProfile(), email: input.email ?? '' },
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  })
}

export async function createUserFromPassword(
  env: Env,
  input: {
    identifierType: 'phone' | 'account'
    identifier: string
    passwordHash: string
    displayName: string
    referredBy?: string
    registerIp?: string
    registerRegion?: string
  },
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  return createUser(env, {
    username: input.identifierType === 'account' ? input.identifier : undefined,
    phoneAccount: input.identifierType === 'phone' ? input.identifier : undefined,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    referredBy: input.referredBy,
    registerIp: input.registerIp,
    registerRegion: input.registerRegion,
    locale: 'en',
    status: 'active',
    profile: input.identifierType === 'phone'
      ? { ...defaultProfile(), phone: input.identifier }
      : defaultProfile(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  })
}

export async function createDevUser(env: Env): Promise<{ user: UserRecord; isNewUser: boolean }> {
  return createUserFromTelegram(env, {
    telegramUserId: 999_000_001,
    displayName: 'Dev Browser User',
  })
}

export async function getWallet(env: Env, userId: string): Promise<WalletRecord> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT available, frozen FROM bg_wallet WHERE user_id = ? AND currency = 'PHP'`,
    [userId],
  )
  if (!rows[0]) return { available: 0, frozen: 0 }
  return { available: Number(rows[0].available), frozen: Number(rows[0].frozen) }
}

export async function getWalletBalances(env: Env, userId: string): Promise<WalletBalance[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT currency, available, frozen FROM bg_wallet WHERE user_id = ? ORDER BY currency`,
    [userId],
  )
  return rows.map((r) => ({
    currency: r.currency as string,
    available: Number(r.available),
    frozen: Number(r.frozen),
  }))
}

export async function creditWallet(
  env: Env,
  userId: string,
  amount: number,
  entry: Omit<LedgerEntry, 'id' | 'userId' | 'balanceAfter' | 'amount'>,
): Promise<WalletRecord> {
  const currency = entry.currency ?? 'PHP'
  const conn = await pool(env).getConnection()
  const ledgerId = `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  try {
    await conn.beginTransaction()
    await conn.execute(
      `INSERT INTO bg_wallet (user_id, currency, available, version)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
      [userId, currency, amount, amount],
    )
    const [wrows] = await conn.query<RowDataPacket[]>(
      `SELECT available, frozen FROM bg_wallet WHERE user_id = ? AND currency = ?`,
      [userId, currency],
    )
    const balanceAfter = Number(wrows[0]?.available ?? 0)
    await conn.execute(
      `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description, trace_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        ledgerId, userId, currency, entry.type, amount, balanceAfter,
        entry.refId ? 'deposit' : null,
        entry.refId ?? null,
        entry.description,
        entry.traceId ?? null,
      ],
    )
    await conn.commit()
    return { available: balanceAfter, frozen: Number(wrows[0]?.frozen ?? 0) }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

export async function listLedger(env: Env, userId: string, limit = 50): Promise<LedgerEntry[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_wallet_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    id: r.id as string,
    userId,
    currency: (r.currency as string) ?? 'PHP',
    type: r.type as LedgerEntry['type'],
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    refId: (r.ref_id as string) ?? undefined,
    description: r.description as string,
    createdAt: new Date(r.created_at as Date).toISOString(),
    traceId: (r.trace_id as string) ?? undefined,
  }))
}

export async function getLedgerEntry(env: Env, userId: string, id: string): Promise<LedgerEntry | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_wallet_ledger WHERE user_id = ? AND id = ?`,
    [userId, id],
  )
  if (!rows[0]) return null
  const r = rows[0]
  return {
    id: r.id as string,
    userId,
    currency: (r.currency as string) ?? 'PHP',
    type: r.type as LedgerEntry['type'],
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    refId: (r.ref_id as string) ?? undefined,
    description: r.description as string,
    createdAt: new Date(r.created_at as Date).toISOString(),
    traceId: (r.trace_id as string) ?? undefined,
  }
}

function mapOrderDeposit(r: RowDataPacket): OrderDeposit {
  const extra = r.extra
    ? (typeof r.extra === 'string' ? JSON.parse(r.extra) : r.extra as Record<string, unknown>)
    : undefined
  return {
    orderId: r.order_id as string,
    userId: r.user_id as string,
    amount: Number(r.amount),
    currency: r.currency as OrderDeposit['currency'],
    channelId: (r.channel as string) ?? 'tg_wallet',
    status: r.status as OrderDeposit['status'],
    createdAt: new Date(r.created_at as Date).toISOString(),
    creditedCents: r.credited ? Number(r.amount) : undefined,
    extraData: extra,
    tgWalletParams: extra?.tgWalletParams as OrderDeposit['tgWalletParams'] ?? undefined,
    tonConnectParams: extra?.tonConnectParams as OrderDeposit['tonConnectParams'] ?? undefined,
  }
}

export async function saveOrderDeposit(env: Env, order: OrderDeposit): Promise<void> {
  const extra: Record<string, unknown> = { ...(order.extraData ?? {}) }
  if (order.tgWalletParams) extra['tgWalletParams'] = order.tgWalletParams
  if (order.tonConnectParams) extra['tonConnectParams'] = order.tonConnectParams
  const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : null

  await pool(env).execute(
    `INSERT INTO bg_deposit_order (order_id, user_id, channel, currency, amount, status, credited, extra)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), credited=VALUES(credited), extra=VALUES(extra)`,
    [
      order.orderId, order.userId, order.channelId, order.currency,
      order.amount, order.status, order.creditedCents ? 1 : 0, extraJson,
    ],
  )
}

export async function getOrderDeposit(env: Env, orderId: string): Promise<OrderDeposit | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_deposit_order WHERE order_id = ?`, [orderId],
  )
  return rows[0] ? mapOrderDeposit(rows[0]) : null
}

export async function listOrderDeposits(env: Env, userId: string, page = 1, pageSize = 20): Promise<OrderDeposit[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_deposit_order WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )
  return rows.map(mapOrderDeposit)
}

export async function updateOrderDepositStatus(
  env: Env, orderId: string, status: OrderDeposit['status'],
  _providerRef?: string, extraDataPatch?: Record<string, unknown>,
): Promise<void> {
  if (extraDataPatch) {
    await pool(env).execute(
      `UPDATE bg_deposit_order SET status=?, extra=JSON_MERGE_PATCH(COALESCE(extra,'{}'),?) WHERE order_id=?`,
      [status, JSON.stringify(extraDataPatch), orderId],
    )
  } else {
    await pool(env).execute(
      `UPDATE bg_deposit_order SET status=? WHERE order_id=?`,
      [status, orderId],
    )
  }
}

// backward-compat aliases
export const saveDeposit = saveOrderDeposit
export const getDeposit = getOrderDeposit
export const listDeposits = listOrderDeposits

function mapOrderWithdraw(r: RowDataPacket): OrderWithdraw {
  const extra = r.extra
    ? (typeof r.extra === 'string' ? JSON.parse(r.extra) : r.extra as Record<string, unknown>)
    : undefined
  return {
    orderId: r.order_id as string,
    userId: r.user_id as string,
    amount: Number(r.amount),
    currency: (r.currency as string) ?? 'PHP',
    channelId: (r.channel as string) ?? 'yfpay',
    status: r.status as OrderWithdraw['status'],
    createdAt: new Date(r.created_at as Date).toISOString(),
    completedAt: extra?.completedAt ? String(extra.completedAt) : undefined,
    rejectReason: r.reject_reason ? String(r.reject_reason) : undefined,
    extraData: extra,
  }
}

export async function saveOrderWithdraw(env: Env, order: OrderWithdraw): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_withdraw_order (order_id, user_id, channel, currency, amount, status, to_address, chain, reject_reason, extra)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), reject_reason=VALUES(reject_reason), extra=VALUES(extra)`,
    [
      order.orderId, order.userId, order.channelId, order.currency,
      order.amount, order.status,
      null, null,
      order.rejectReason ?? null,
      order.extraData ? JSON.stringify(order.extraData) : null,
    ],
  )
}

export async function getOrderWithdraw(env: Env, orderId: string): Promise<OrderWithdraw | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_withdraw_order WHERE order_id = ?`, [orderId],
  )
  return rows[0] ? mapOrderWithdraw(rows[0]) : null
}

export async function listOrderWithdrawals(env: Env, userId: string, page = 1, pageSize = 20): Promise<OrderWithdraw[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_withdraw_order WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )
  return rows.map(mapOrderWithdraw)
}

export async function updateOrderWithdrawStatus(
  env: Env, orderId: string, status: OrderWithdraw['status'],
  opts?: { rejectReason?: string; providerRef?: string },
): Promise<void> {
  await pool(env).execute(
    `UPDATE bg_withdraw_order SET status=?, reject_reason=COALESCE(?,reject_reason) WHERE order_id=?`,
    [status, opts?.rejectReason ?? null, orderId],
  )
}

// backward-compat aliases
export const saveWithdraw = saveOrderWithdraw
export const getWithdraw = getOrderWithdraw
export const listWithdrawals = listOrderWithdrawals

export async function recordUserLogin(
  env: Env,
  userId: string,
  opts: { ip?: string; region?: string; userAgent?: string; authMethod?: string },
): Promise<void> {
  const conn = await pool(env).getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      `UPDATE bg_user SET last_login_at = NOW(3), last_login_ip = ?, last_login_region = ? WHERE id = ?`,
      [opts.ip ?? null, opts.region ?? null, userId],
    )
    await conn.execute(
      `INSERT INTO bg_login_log (user_id, ip, region, user_agent, auth_method) VALUES (?,?,?,?,?)`,
      [userId, opts.ip ?? null, opts.region ?? null, opts.userAgent?.slice(0, 512) ?? null, opts.authMethod ?? 'telegram'],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

function mapKyc(r: RowDataPacket): KycSubmission {
  const gemini = r.gemini_result
    ? (typeof r.gemini_result === 'string' ? JSON.parse(r.gemini_result) : r.gemini_result)
    : undefined
  const liveness = r.liveness_frames
    ? (typeof r.liveness_frames === 'string' ? JSON.parse(r.liveness_frames) : r.liveness_frames)
    : undefined
  return {
    submissionId: r.user_id as string,
    userId: r.user_id as string,
    status: r.status as KycSubmission['status'],
    fullName: (r.full_name as string) ?? '',
    gender: '',
    dob: '',
    docType: (r.doc_type as string) ?? undefined,
    rejectReason: (r.reject_reason as string) ?? undefined,
    submittedAt: r.submitted_at ? new Date(r.submitted_at as Date).toISOString() : '',
    phone: (r.phone as string) ?? undefined,
    phoneVerified: Boolean(r.phone_verified),
    docVerified: Boolean(r.doc_verified),
    faceVerified: Boolean(r.face_verified),
    rejectStep: (r.reject_step as KycSubmission['rejectStep']) ?? undefined,
    verifyMode: (r.verify_mode as KycSubmission['verifyMode']) ?? undefined,
    extractedIdNo: (r.extracted_id_no as string) ?? undefined,
    geminiConfidence: r.gemini_confidence != null ? Number(r.gemini_confidence) : undefined,
    geminiResult: gemini,
    docImageKey: (r.doc_image_key as string) ?? undefined,
    selfieImageKey: (r.selfie_image_key as string) ?? undefined,
    livenessFrames: liveness as KycSubmission['livenessFrames'],
    docSubmittedAt: r.doc_submitted_at ? new Date(r.doc_submitted_at as Date).toISOString() : undefined,
    faceSubmittedAt: r.face_submitted_at ? new Date(r.face_submitted_at as Date).toISOString() : undefined,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as Date).toISOString() : undefined,
  }
}

export async function getKyc(env: Env, userId: string): Promise<KycSubmission | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(`SELECT * FROM bg_kyc WHERE user_id = ?`, [userId])
  return rows[0] ? mapKyc(rows[0]) : null
}

export async function saveKyc(env: Env, s: KycSubmission): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_kyc (user_id, status, phone, phone_verified, doc_verified, face_verified, full_name, doc_type, verify_mode,
       extracted_id_no, gemini_confidence, gemini_result, doc_image_key, selfie_image_key, liveness_frames,
       reject_reason, reject_step, submitted_at, doc_submitted_at, face_submitted_at, reviewed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       status=VALUES(status), phone=COALESCE(VALUES(phone), phone),
       phone_verified=VALUES(phone_verified), doc_verified=VALUES(doc_verified), face_verified=VALUES(face_verified),
       full_name=COALESCE(VALUES(full_name), full_name),
       doc_type=VALUES(doc_type), verify_mode=VALUES(verify_mode),
       extracted_id_no=VALUES(extracted_id_no), gemini_confidence=VALUES(gemini_confidence),
       gemini_result=VALUES(gemini_result), doc_image_key=VALUES(doc_image_key),
       selfie_image_key=VALUES(selfie_image_key), liveness_frames=VALUES(liveness_frames),
       reject_reason=VALUES(reject_reason), reject_step=VALUES(reject_step),
       submitted_at=COALESCE(VALUES(submitted_at), submitted_at),
       doc_submitted_at=COALESCE(VALUES(doc_submitted_at), doc_submitted_at),
       face_submitted_at=COALESCE(VALUES(face_submitted_at), face_submitted_at),
       reviewed_at=COALESCE(VALUES(reviewed_at), reviewed_at)`,
    [
      s.userId, s.status, s.phone ?? null, s.phoneVerified ? 1 : 0, s.docVerified ? 1 : 0, s.faceVerified ? 1 : 0,
      s.fullName || null, s.docType ?? null, s.verifyMode ?? null, s.extractedIdNo ?? null,
      s.geminiConfidence ?? null, s.geminiResult ? JSON.stringify(s.geminiResult) : null,
      s.docImageKey ?? null, s.selfieImageKey ?? null,
      s.livenessFrames ? JSON.stringify(s.livenessFrames) : null,
      s.rejectReason ?? null, s.rejectStep ?? null,
      s.submittedAt ? new Date(s.submittedAt) : null,
      s.docSubmittedAt ? new Date(s.docSubmittedAt) : null,
      s.faceSubmittedAt ? new Date(s.faceSubmittedAt) : null,
      s.reviewedAt ? new Date(s.reviewedAt) : null,
    ],
  )
}

/** 防重：是否存在「其他用户」已用该手机通过/验证过 KYC */
export async function findKycByVerifiedPhone(env: Env, phone: string, exceptUserId: string): Promise<string | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT user_id FROM bg_kyc WHERE phone = ? AND phone_verified = 1 AND user_id <> ? LIMIT 1`,
    [phone, exceptUserId],
  )
  return rows[0] ? (rows[0].user_id as string) : null
}

/** 防重：是否存在「其他用户」已用该证件号通过 KYC */
export async function findKycByExtractedIdNo(env: Env, idNo: string, exceptUserId: string): Promise<string | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT user_id FROM bg_kyc WHERE extracted_id_no = ? AND status = 'approved' AND user_id <> ? LIMIT 1`,
    [idNo, exceptUserId],
  )
  return rows[0] ? (rows[0].user_id as string) : null
}

export async function adminAdjustBalance(
  env: Env,
  userId: string,
  amount: number,
  opts: { adminUsername: string; note?: string; traceId?: string; currency?: string },
): Promise<{ available: number; orderId: string }> {
  if (amount === 0) throw new Error('amount must be non-zero')

  const currency = opts.currency ?? 'PHP'
  const conn = await pool(env).getConnection()
  const orderId = `ADM_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const ledgerId = `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const description = opts.note ?? `Admin adjustment by ${opts.adminUsername}`

  try {
    await conn.beginTransaction()

    if (amount > 0) {
      await conn.execute(
        `INSERT INTO bg_deposit_order (order_id, user_id, channel, currency, amount, status, credited)
         VALUES (?,?,?,?,?,?,?)`,
        [orderId, userId, 'admin', currency, amount, 'paid', 1],
      )
    } else {
      const [wrows] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ? FOR UPDATE`,
        [userId, currency],
      )
      const current = Number(wrows[0]?.available ?? 0)
      if (current + amount < 0) {
        await conn.rollback()
        throw new Error(`Insufficient balance: current=${current}, adjustment=${amount}`)
      }
      await conn.execute(
        `INSERT INTO bg_withdraw_order (order_id, user_id, channel, currency, amount, status)
         VALUES (?,?,?,?,?,?)`,
        [orderId, userId, 'admin', currency, Math.abs(amount), 'completed'],
      )
    }

    await conn.execute(
      `INSERT INTO bg_wallet (user_id, currency, available, version)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
      [userId, currency, amount, amount],
    )
    const [wrows] = await conn.query<RowDataPacket[]>(
      `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
      [userId, currency],
    )
    const balanceAfter = Number(wrows[0]?.available ?? 0)

    await conn.execute(
      `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description, trace_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        ledgerId, userId, currency, 'admin_adjust', amount, balanceAfter,
        amount > 0 ? 'deposit' : 'withdraw', orderId, description, opts.traceId ?? null,
      ],
    )

    await conn.commit()
    return { available: balanceAfter, orderId }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}
