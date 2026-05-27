import type { Pool, RowDataPacket } from 'mysql2/promise'
import type {
  OrderDeposit,
  OrderWithdraw,
  KycSubmission,
  LedgerEntry,
  UserRecord,
  WalletRecord,
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
  google_sub: string | null
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
    googleSub: row.google_sub ?? undefined,
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
      `INSERT INTO bg_user (id, telegram_user_id, telegram_username, google_sub, email, display_name, avatar_url, invite_code, inviter_id, locale, status, status_reason, label, register_ip, register_region, registered_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         telegram_username=VALUES(telegram_username),
         display_name=VALUES(display_name), avatar_url=VALUES(avatar_url), email=VALUES(email),
         locale=VALUES(locale), status=VALUES(status), status_reason=VALUES(status_reason),
         label=VALUES(label)`,
      [
        user.id,
        user.telegramUserId ?? null,
        user.telegramUsername ?? null,
        user.googleSub ?? null,
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

export async function getUserByGoogleSub(env: Env, sub: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.google_sub = ?`, [sub])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function getUserByInviteCode(env: Env, code: string): Promise<UserRecord | null> {
  const [rows] = await pool(env).query<UserRow[]>(`${USER_SELECT} WHERE u.invite_code = ?`, [
    code.toUpperCase(),
  ])
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
      `INSERT INTO bg_wallet (user_id, available_cents, frozen_cents) VALUES (?,0,0)
       ON DUPLICATE KEY UPDATE user_id=user_id`,
      [id],
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

export async function createUserFromGoogle(
  env: Env,
  input: {
    googleSub: string
    email?: string
    displayName: string
    avatarUrl?: string
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

export async function createDevUser(env: Env): Promise<{ user: UserRecord; isNewUser: boolean }> {
  return createUserFromTelegram(env, {
    telegramUserId: 999_000_001,
    displayName: 'Dev Browser User',
  })
}

export async function getWallet(env: Env, userId: string): Promise<WalletRecord> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT available_cents, frozen_cents FROM bg_wallet WHERE user_id = ?`,
    [userId],
  )
  if (!rows[0]) return { available: 0, frozen: 0 }
  return { available: Number(rows[0].available_cents), frozen: Number(rows[0].frozen_cents) }
}

export async function creditWallet(
  env: Env,
  userId: string,
  cents: number,
  entry: Omit<LedgerEntry, 'id' | 'userId' | 'balanceAfter' | 'amount'>,
): Promise<WalletRecord> {
  const conn = await pool(env).getConnection()
  const ledgerId = `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  try {
    await conn.beginTransaction()
    await conn.execute(
      `UPDATE bg_wallet SET available_cents = available_cents + ?, version = version + 1 WHERE user_id = ?`,
      [cents, userId],
    )
    const [wrows] = await conn.query<RowDataPacket[]>(
      `SELECT available_cents, frozen_cents FROM bg_wallet WHERE user_id = ?`,
      [userId],
    )
    const balanceAfter = Number(wrows[0]?.available_cents ?? 0)
    await conn.execute(
      `INSERT INTO bg_wallet_ledger (id, user_id, type, amount_cents, balance_after, ref_type, ref_id, description, trace_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        ledgerId,
        userId,
        entry.type,
        cents,
        balanceAfter,
        entry.refId ? 'deposit' : null,
        entry.refId ?? null,
        entry.description,
        entry.traceId ?? null,
      ],
    )
    await conn.commit()
    return { available: balanceAfter, frozen: Number(wrows[0]?.frozen_cents ?? 0) }
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
    type: r.type as LedgerEntry['type'],
    amount: Number(r.amount_cents),
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
    type: r.type as LedgerEntry['type'],
    amount: Number(r.amount_cents),
    balanceAfter: Number(r.balance_after),
    refId: (r.ref_id as string) ?? undefined,
    description: r.description as string,
    createdAt: new Date(r.created_at as Date).toISOString(),
    traceId: (r.trace_id as string) ?? undefined,
  }
}

function mapOrderDeposit(r: RowDataPacket): OrderDeposit {
  return {
    orderId: r.order_id as string,
    userId: r.user_id as string,
    amount: Number(r.amount),
    currency: r.currency as OrderDeposit['currency'],
    channelId: (r.channel_id as string) ?? 'tg_wallet',
    status: r.status as OrderDeposit['status'],
    createdAt: new Date(r.created_at as Date).toISOString(),
    paidAt: r.paid_at ? new Date(r.paid_at as Date).toISOString() : undefined,
    creditedCents: r.credited_cents != null ? Number(r.credited_cents) : undefined,
    provider: r.provider ? String(r.provider) : undefined,
    providerRef: r.provider_ref ? String(r.provider_ref) : undefined,
    extraData: r.extra_data ? (typeof r.extra_data === 'string' ? JSON.parse(r.extra_data) : r.extra_data as Record<string, unknown>) : undefined,
    tgWalletParams: r.tg_payload ? JSON.parse(String(r.tg_payload)) : undefined,
  }
}

export async function saveOrderDeposit(env: Env, order: OrderDeposit): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_order_deposit (order_id, user_id, amount, currency, credited_cents, channel_id, status, provider, provider_ref, extra_data, tg_payload, paid_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), credited_cents=VALUES(credited_cents), provider_ref=VALUES(provider_ref), extra_data=VALUES(extra_data), paid_at=VALUES(paid_at), tg_payload=VALUES(tg_payload)`,
    [
      order.orderId, order.userId, order.amount, order.currency,
      order.creditedCents ?? null, order.channelId, order.status,
      order.provider ?? 'ammer_pay', order.providerRef ?? null,
      order.extraData ? JSON.stringify(order.extraData) : null,
      order.tgWalletParams ? JSON.stringify(order.tgWalletParams) : null,
      order.paidAt ? new Date(order.paidAt) : null,
    ],
  )
}

export async function getOrderDeposit(env: Env, orderId: string): Promise<OrderDeposit | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_order_deposit WHERE order_id = ?`, [orderId],
  )
  return rows[0] ? mapOrderDeposit(rows[0]) : null
}

export async function listOrderDeposits(env: Env, userId: string, page = 1, pageSize = 20): Promise<OrderDeposit[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_order_deposit WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )
  return rows.map(mapOrderDeposit)
}

export async function updateOrderDepositStatus(
  env: Env, orderId: string, status: OrderDeposit['status'],
  providerRef?: string, extraDataPatch?: Record<string, unknown>,
): Promise<void> {
  const paidAt = status === 'paid' ? new Date() : null
  if (extraDataPatch) {
    await pool(env).execute(
      `UPDATE bg_order_deposit SET status=?, provider_ref=COALESCE(?,provider_ref), paid_at=COALESCE(?,paid_at), extra_data=JSON_MERGE_PATCH(COALESCE(extra_data,'{}'),?) WHERE order_id=?`,
      [status, providerRef ?? null, paidAt, JSON.stringify(extraDataPatch), orderId],
    )
  } else {
    await pool(env).execute(
      `UPDATE bg_order_deposit SET status=?, provider_ref=COALESCE(?,provider_ref), paid_at=COALESCE(?,paid_at) WHERE order_id=?`,
      [status, providerRef ?? null, paidAt, orderId],
    )
  }
}

// backward-compat aliases
export const saveDeposit = saveOrderDeposit
export const getDeposit = getOrderDeposit
export const listDeposits = listOrderDeposits

function mapOrderWithdraw(r: RowDataPacket): OrderWithdraw {
  return {
    orderId: r.order_id as string,
    userId: r.user_id as string,
    amount: Number(r.amount_cents),
    currency: 'PHP',
    channelId: (r.channel_id as string) ?? 'tg_wallet',
    status: r.status as OrderWithdraw['status'],
    createdAt: new Date(r.created_at as Date).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at as Date).toISOString() : undefined,
    rejectReason: r.reject_reason ? String(r.reject_reason) : undefined,
    provider: r.provider ? String(r.provider) : undefined,
    providerRef: r.provider_ref ? String(r.provider_ref) : undefined,
    extraData: r.extra_data ? (typeof r.extra_data === 'string' ? JSON.parse(r.extra_data) : r.extra_data as Record<string, unknown>) : undefined,
  }
}

export async function saveOrderWithdraw(env: Env, order: OrderWithdraw): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_order_withdraw (order_id, user_id, amount_cents, currency, channel_id, status, provider, provider_ref, extra_data, reject_reason, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), provider_ref=VALUES(provider_ref), extra_data=VALUES(extra_data), reject_reason=VALUES(reject_reason), completed_at=VALUES(completed_at)`,
    [
      order.orderId, order.userId, order.amount, order.currency,
      order.channelId, order.status, order.provider ?? null, order.providerRef ?? null,
      order.extraData ? JSON.stringify(order.extraData) : null,
      order.rejectReason ?? null,
      order.completedAt ? new Date(order.completedAt) : null,
    ],
  )
}

export async function getOrderWithdraw(env: Env, orderId: string): Promise<OrderWithdraw | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_order_withdraw WHERE order_id = ?`, [orderId],
  )
  return rows[0] ? mapOrderWithdraw(rows[0]) : null
}

export async function listOrderWithdrawals(env: Env, userId: string, page = 1, pageSize = 20): Promise<OrderWithdraw[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_order_withdraw WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )
  return rows.map(mapOrderWithdraw)
}

export async function updateOrderWithdrawStatus(
  env: Env, orderId: string, status: OrderWithdraw['status'],
  opts?: { rejectReason?: string; providerRef?: string },
): Promise<void> {
  const completedAt = (status === 'completed' || status === 'rejected') ? new Date() : null
  await pool(env).execute(
    `UPDATE bg_order_withdraw SET status=?, provider_ref=COALESCE(?,provider_ref), reject_reason=COALESCE(?,reject_reason), completed_at=COALESCE(?,completed_at) WHERE order_id=?`,
    [status, opts?.providerRef ?? null, opts?.rejectReason ?? null, completedAt, orderId],
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

export async function getKyc(_env: Env, _userId: string): Promise<KycSubmission | null> {
  return null
}

export async function saveKyc(_env: Env, _submission: KycSubmission): Promise<void> {
  /* KYC still optional; extend to bg_kyc_submission when needed */
}

export async function adminAdjustBalance(
  env: Env,
  userId: string,
  cents: number,
  opts: { adminUsername: string; note?: string; traceId?: string },
): Promise<{ available: number; orderId: string }> {
  if (cents === 0) throw new Error('cents must be non-zero')

  const conn = await pool(env).getConnection()
  const orderId = `ADM_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const ledgerId = `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const description = opts.note ?? `Admin adjustment by ${opts.adminUsername}`

  try {
    await conn.beginTransaction()

    if (cents > 0) {
      // 存款记录（管理员充值）
      await conn.execute(
        `INSERT INTO bg_order_deposit (order_id, user_id, amount, currency, credited_cents, channel_id, status, provider, paid_at)
         VALUES (?,?,?,?,?,?,?,?,NOW(3))`,
        [orderId, userId, (cents / 100).toFixed(2), 'PHP', cents, 'admin', 'paid', 'admin'],
      )
    } else {
      // 先检查余额是否足够
      const [wrows] = await conn.query<RowDataPacket[]>(
        `SELECT available_cents FROM bg_wallet WHERE user_id = ? FOR UPDATE`,
        [userId],
      )
      const current = Number(wrows[0]?.available_cents ?? 0)
      if (current + cents < 0) {
        await conn.rollback()
        throw new Error(`Insufficient balance: current=${current}, adjustment=${cents}`)
      }
      // 取款记录（管理员扣款）
      await conn.execute(
        `INSERT INTO bg_order_withdraw (order_id, user_id, amount_cents, currency, channel_id, status, completed_at)
         VALUES (?,?,?,?,?,?,NOW(3))`,
        [orderId, userId, Math.abs(cents), 'PHP', 'admin', 'completed'],
      )
    }

    // 更新钱包
    await conn.execute(
      `UPDATE bg_wallet SET available_cents = available_cents + ?, version = version + 1 WHERE user_id = ?`,
      [cents, userId],
    )
    const [wrows] = await conn.query<RowDataPacket[]>(
      `SELECT available_cents, frozen_cents FROM bg_wallet WHERE user_id = ?`,
      [userId],
    )
    const balanceAfter = Number(wrows[0]?.available_cents ?? 0)

    // 账变记录
    await conn.execute(
      `INSERT INTO bg_wallet_ledger (id, user_id, type, amount_cents, balance_after, ref_type, ref_id, description, trace_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        ledgerId,
        userId,
        'admin_adjust',
        cents,
        balanceAfter,
        cents > 0 ? 'deposit' : 'withdraw',
        orderId,
        description,
        opts.traceId ?? null,
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
