import type { Pool, RowDataPacket } from 'mysql2/promise'
import type {
  DepositOrder,
  KycSubmission,
  LedgerEntry,
  UserRecord,
  WalletRecord,
  WithdrawOrder,
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
  google_sub: string | null
  email: string | null
  display_name: string
  avatar_url: string | null
  invite_code: string
  inviter_id: string | null
  locale: string
  status: UserRecord['status']
  status_reason: string | null
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
    googleSub: row.google_sub ?? undefined,
    email: row.email ?? undefined,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    inviteCode: row.invite_code,
    referredBy: row.inviter_id ?? undefined,
    locale: row.locale as UserRecord['locale'],
    status: row.status,
    statusReason: row.status_reason ?? undefined,
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
      `INSERT INTO bg_user (id, telegram_user_id, google_sub, email, display_name, avatar_url, invite_code, inviter_id, locale, status, status_reason, registered_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         display_name=VALUES(display_name), avatar_url=VALUES(avatar_url), email=VALUES(email),
         locale=VALUES(locale), status=VALUES(status), status_reason=VALUES(status_reason)`,
      [
        user.id,
        user.telegramUserId ?? null,
        user.googleSub ?? null,
        user.email ?? null,
        user.displayName,
        user.avatarUrl ?? null,
        user.inviteCode,
        user.referredBy ?? null,
        user.locale,
        user.status,
        user.statusReason ?? null,
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

function mapDeposit(r: RowDataPacket): DepositOrder {
  return {
    orderId: r.order_id as string,
    userId: r.user_id as string,
    amount: Number(r.amount),
    currency: r.currency as DepositOrder['currency'],
    channelId: 'tg_wallet',
    status: r.status as DepositOrder['status'],
    createdAt: new Date(r.created_at as Date).toISOString(),
    paidAt: r.paid_at ? new Date(r.paid_at as Date).toISOString() : undefined,
    creditedCents: r.credited_cents != null ? Number(r.credited_cents) : undefined,
    tgWalletParams: r.tg_payload ? JSON.parse(String(r.tg_payload)) : undefined,
  }
}

export async function saveDeposit(env: Env, order: DepositOrder): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_deposit_order (order_id, user_id, amount, currency, credited_cents, channel_id, status, provider, tg_payload, paid_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), credited_cents=VALUES(credited_cents), paid_at=VALUES(paid_at), tg_payload=VALUES(tg_payload)`,
    [
      order.orderId,
      order.userId,
      order.amount,
      order.currency,
      order.creditedCents ?? null,
      order.channelId,
      order.status,
      'ammer_pay',
      order.tgWalletParams ? JSON.stringify(order.tgWalletParams) : null,
      order.paidAt ? new Date(order.paidAt) : null,
    ],
  )
}

export async function getDeposit(env: Env, orderId: string): Promise<DepositOrder | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_deposit_order WHERE order_id = ?`,
    [orderId],
  )
  return rows[0] ? mapDeposit(rows[0]) : null
}

export async function listDeposits(
  env: Env,
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<DepositOrder[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_deposit_order WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )
  return rows.map(mapDeposit)
}

function mapWithdraw(r: RowDataPacket): WithdrawOrder {
  return {
    orderId: r.order_id as string,
    userId: r.user_id as string,
    amount: Number(r.amount_cents),
    currency: 'PHP',
    channelId: 'tg_wallet',
    status: r.status as WithdrawOrder['status'],
    createdAt: new Date(r.created_at as Date).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at as Date).toISOString() : undefined,
    rejectReason: (r.reject_reason as string) ?? undefined,
  }
}

export async function saveWithdraw(env: Env, order: WithdrawOrder): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bg_withdraw_order (order_id, user_id, amount_cents, currency, channel_id, status, reject_reason, completed_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), reject_reason=VALUES(reject_reason), completed_at=VALUES(completed_at)`,
    [
      order.orderId,
      order.userId,
      order.amount,
      order.currency,
      order.channelId,
      order.status,
      order.rejectReason ?? null,
      order.completedAt ? new Date(order.completedAt) : null,
    ],
  )
}

export async function getWithdraw(env: Env, orderId: string): Promise<WithdrawOrder | null> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_withdraw_order WHERE order_id = ?`,
    [orderId],
  )
  return rows[0] ? mapWithdraw(rows[0]) : null
}

export async function listWithdrawals(
  env: Env,
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<WithdrawOrder[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT * FROM bg_withdraw_order WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )
  return rows.map(mapWithdraw)
}

export async function getKyc(_env: Env, _userId: string): Promise<KycSubmission | null> {
  return null
}

export async function saveKyc(_env: Env, _submission: KycSubmission): Promise<void> {
  /* KYC still optional; extend to bg_kyc_submission when needed */
}
