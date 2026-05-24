import type { Redis } from 'ioredis'
import type {
  DepositOrder,
  KycSubmission,
  LedgerEntry,
  SessionRecord,
  UserRecord,
  WalletRecord,
  WithdrawOrder,
} from '../../types/domain.js'
import { generateInviteCode } from '../../utils/id.js'
import { nowIso } from '../../utils/format.js'

const KEYS = {
  userSeq: 'tma:user:seq',
  user: (id: string) => `tma:user:${id}`,
  userByTg: (tgId: number) => `tma:user:tg:${tgId}`,
  userByGoogle: (sub: string) => `tma:user:google:${sub}`,
  session: (token: string) => `tma:session:${token}`,
  wallet: (userId: string) => `tma:wallet:${userId}`,
  deposit: (orderId: string) => `tma:deposit:${orderId}`,
  userDeposits: (userId: string) => `tma:deposits:user:${userId}`,
  withdraw: (orderId: string) => `tma:withdraw:${orderId}`,
  userWithdrawals: (userId: string) => `tma:withdrawals:user:${userId}`,
  ledger: (userId: string) => `tma:ledger:user:${userId}`,
  kyc: (userId: string) => `tma:kyc:user:${userId}`,
  inviteCode: (code: string) => `tma:invite:${code}`,
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

function defaultWallet(): WalletRecord {
  return { available: 0, frozen: 0 }
}

export async function nextUserId(redis: Redis): Promise<string> {
  const seq = await redis.incr(KEYS.userSeq)
  return `BG-${10000 + seq}`
}

export async function saveUser(redis: Redis, user: UserRecord): Promise<void> {
  await redis.set(KEYS.user(user.id), JSON.stringify(user))
  if (user.telegramUserId) {
    await redis.set(KEYS.userByTg(user.telegramUserId), user.id)
  }
  if (user.googleSub) {
    await redis.set(KEYS.userByGoogle(user.googleSub), user.id)
  }
  await redis.set(KEYS.inviteCode(user.inviteCode), user.id)
}

export async function getUser(redis: Redis, userId: string): Promise<UserRecord | null> {
  const raw = await redis.get(KEYS.user(userId))
  return raw ? (JSON.parse(raw) as UserRecord) : null
}

export async function getUserByTelegramId(redis: Redis, tgId: number): Promise<UserRecord | null> {
  const userId = await redis.get(KEYS.userByTg(tgId))
  if (!userId) return null
  return getUser(redis, userId)
}

export async function getUserByInviteCode(redis: Redis, code: string): Promise<UserRecord | null> {
  const userId = await redis.get(KEYS.inviteCode(code))
  if (!userId) return null
  return getUser(redis, userId)
}

export async function createUserFromTelegram(
  redis: Redis,
  input: {
    telegramUserId: number
    displayName: string
    avatarUrl?: string
    referredBy?: string
  },
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  const existing = await getUserByTelegramId(redis, input.telegramUserId)
  if (existing) return { user: existing, isNewUser: false }

  const id = await nextUserId(redis)
  let inviteCode = generateInviteCode()
  while (await redis.get(KEYS.inviteCode(inviteCode))) {
    inviteCode = generateInviteCode()
  }

  const user: UserRecord = {
    id,
    telegramUserId: input.telegramUserId,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    inviteCode,
    referredBy: input.referredBy,
    locale: 'en',
    status: 'active',
    registeredAt: nowIso(),
    profile: defaultProfile(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  }
  await saveUser(redis, user)
  await redis.set(KEYS.wallet(id), JSON.stringify(defaultWallet()))
  return { user, isNewUser: true }
}

export async function getUserByGoogleSub(redis: Redis, sub: string): Promise<UserRecord | null> {
  const userId = await redis.get(KEYS.userByGoogle(sub))
  if (!userId) return null
  return getUser(redis, userId)
}

export async function createUserFromGoogle(
  redis: Redis,
  input: {
    googleSub: string
    email?: string
    displayName: string
    avatarUrl?: string
  },
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  const existing = await getUserByGoogleSub(redis, input.googleSub)
  if (existing) return { user: existing, isNewUser: false }

  const id = await nextUserId(redis)
  let inviteCode = generateInviteCode()
  while (await redis.get(KEYS.inviteCode(inviteCode))) {
    inviteCode = generateInviteCode()
  }

  const user: UserRecord = {
    id,
    googleSub: input.googleSub,
    email: input.email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    inviteCode,
    locale: 'en',
    status: 'active',
    registeredAt: nowIso(),
    profile: { ...defaultProfile(), email: input.email ?? '' },
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  }
  await saveUser(redis, user)
  await redis.set(KEYS.wallet(id), JSON.stringify(defaultWallet()))
  return { user, isNewUser: true }
}

export async function createDevUser(redis: Redis): Promise<{ user: UserRecord; isNewUser: boolean }> {
  return createUserFromTelegram(redis, {
    telegramUserId: 999_000_001,
    displayName: 'Dev Browser User',
  })
}

export async function saveSession(
  redis: Redis,
  token: string,
  session: SessionRecord,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(KEYS.session(token), JSON.stringify(session), 'EX', ttlSeconds)
}

export async function getSession(redis: Redis, token: string): Promise<SessionRecord | null> {
  const raw = await redis.get(KEYS.session(token))
  return raw ? (JSON.parse(raw) as SessionRecord) : null
}

export async function deleteSession(redis: Redis, token: string): Promise<void> {
  await redis.del(KEYS.session(token))
}

export async function getWallet(redis: Redis, userId: string): Promise<WalletRecord> {
  const raw = await redis.get(KEYS.wallet(userId))
  return raw ? (JSON.parse(raw) as WalletRecord) : defaultWallet()
}

export async function saveWallet(redis: Redis, userId: string, wallet: WalletRecord): Promise<void> {
  await redis.set(KEYS.wallet(userId), JSON.stringify(wallet))
}

export async function creditWallet(
  redis: Redis,
  userId: string,
  cents: number,
  entry: Omit<LedgerEntry, 'id' | 'userId' | 'balanceAfter' | 'amount'>,
): Promise<WalletRecord> {
  const wallet = await getWallet(redis, userId)
  wallet.available += cents
  await saveWallet(redis, userId, wallet)
  await appendLedger(redis, userId, { ...entry, amount: cents, balanceAfter: wallet.available })
  return wallet
}

export async function appendLedger(
  redis: Redis,
  userId: string,
  partial: Omit<LedgerEntry, 'id' | 'userId'>,
): Promise<LedgerEntry> {
  const entry: LedgerEntry = {
    id: `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    ...partial,
  }
  await redis.lpush(KEYS.ledger(userId), JSON.stringify(entry))
  return entry
}

export async function listLedger(redis: Redis, userId: string, limit = 50): Promise<LedgerEntry[]> {
  const rows = await redis.lrange(KEYS.ledger(userId), 0, limit - 1)
  return rows.map((r: string) => JSON.parse(r) as LedgerEntry)
}

export async function getLedgerEntry(redis: Redis, userId: string, id: string): Promise<LedgerEntry | null> {
  const rows = await listLedger(redis, userId, 200)
  return rows.find((e) => e.id === id) ?? null
}

export async function saveDeposit(redis: Redis, order: DepositOrder): Promise<void> {
  await redis.set(KEYS.deposit(order.orderId), JSON.stringify(order))
  await redis.lpush(KEYS.userDeposits(order.userId), order.orderId)
}

export async function getDeposit(redis: Redis, orderId: string): Promise<DepositOrder | null> {
  const raw = await redis.get(KEYS.deposit(orderId))
  return raw ? (JSON.parse(raw) as DepositOrder) : null
}

export async function listDeposits(redis: Redis, userId: string, page = 1, pageSize = 20): Promise<DepositOrder[]> {
  const ids = await redis.lrange(KEYS.userDeposits(userId), (page - 1) * pageSize, page * pageSize - 1)
  const orders: DepositOrder[] = []
  for (const id of ids) {
    const o = await getDeposit(redis, id)
    if (o) orders.push(o)
  }
  return orders
}

export async function saveWithdraw(redis: Redis, order: WithdrawOrder): Promise<void> {
  await redis.set(KEYS.withdraw(order.orderId), JSON.stringify(order))
  await redis.lpush(KEYS.userWithdrawals(order.userId), order.orderId)
}

export async function getWithdraw(redis: Redis, orderId: string): Promise<WithdrawOrder | null> {
  const raw = await redis.get(KEYS.withdraw(orderId))
  return raw ? (JSON.parse(raw) as WithdrawOrder) : null
}

export async function listWithdrawals(
  redis: Redis,
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<WithdrawOrder[]> {
  const ids = await redis.lrange(KEYS.userWithdrawals(userId), (page - 1) * pageSize, page * pageSize - 1)
  const orders: WithdrawOrder[] = []
  for (const id of ids) {
    const o = await getWithdraw(redis, id)
    if (o) orders.push(o)
  }
  return orders
}

export async function getKyc(redis: Redis, userId: string): Promise<KycSubmission | null> {
  const raw = await redis.get(KEYS.kyc(userId))
  return raw ? (JSON.parse(raw) as KycSubmission) : null
}

export async function saveKyc(redis: Redis, submission: KycSubmission): Promise<void> {
  await redis.set(KEYS.kyc(submission.userId), JSON.stringify(submission))
}
