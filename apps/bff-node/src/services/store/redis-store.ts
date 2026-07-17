import type { Redis } from 'ioredis'
import type {
  DepositOrder,
  IdentityProvider,
  KycSubmission,
  LedgerEntry,
  SessionRecord,
  UserIdentity,
  UserRecord,
  WalletRecord,
  WithdrawOrder,
} from '../../types/domain.js'
import { generateInviteCode } from '../../utils/id.js'
import { nowIso } from '../../utils/format.js'

const KEYS = {
  userSeq: 'tma:user:seq',
  user: (id: string) => `tma:user:${id}`,
  identity: (provider: IdentityProvider, identifier: string) => `tma:identity:${provider}:${identifier}`,
  userIdentities: (userId: string) => `tma:identities:user:${userId}`,
  userByEmail: (email: string) => `tma:user:email:${email}`,
  session: (token: string) => `tma:session:${token}`,
  wallet: (userId: string) => `tma:wallet:${userId}`,
  deposit: (orderId: string) => `tma:deposit:${orderId}`,
  userDeposits: (userId: string) => `tma:deposits:user:${userId}`,
  withdraw: (orderId: string) => `tma:withdraw:${orderId}`,
  userWithdrawals: (userId: string) => `tma:withdrawals:user:${userId}`,
  ledger: (userId: string) => `tma:ledger:user:${userId}`,
  kyc: (userId: string) => `tma:kyc:user:${userId}`,
  kycByPhone: (phone: string) => `tma:kyc:phone:${phone}`,
  kycByIdNo: (idNo: string) => `tma:kyc:idno:${idNo}`,
  inviteCode: (code: string) => `tma:invite:${code}`,
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
  if (user.email) {
    await redis.set(KEYS.userByEmail(user.email), user.id)
  }
  await redis.set(KEYS.inviteCode(user.inviteCode), user.id)
}

export async function listUserIdentities(redis: Redis, userId: string): Promise<UserIdentity[]> {
  const raw = await redis.lrange(KEYS.userIdentities(userId), 0, -1)
  return raw.map((s) => JSON.parse(s) as UserIdentity)
}

export async function getUserIdentity(
  redis: Redis,
  provider: IdentityProvider,
  identifier: string,
): Promise<UserIdentity | null> {
  const raw = await redis.get(KEYS.identity(provider, identifier))
  return raw ? (JSON.parse(raw) as UserIdentity) : null
}

export async function getUserByIdentity(
  redis: Redis,
  provider: IdentityProvider,
  identifier: string,
): Promise<UserRecord | null> {
  const identity = await getUserIdentity(redis, provider, identifier)
  return identity ? getUser(redis, identity.userId) : null
}

export async function getUserByTelegramOidcUsername(redis: Redis, username: string): Promise<UserRecord | null> {
  const keys = await redis.keys(KEYS.identity('telegram_oidc', '*'))
  const matches: UserIdentity[] = []
  for (const key of keys) {
    const raw = await redis.get(key)
    if (!raw) continue
    const identity = JSON.parse(raw) as UserIdentity
    if (identity.displayLabel === username) matches.push(identity)
    if (matches.length > 1) return null
  }
  return matches[0] ? getUser(redis, matches[0].userId) : null
}

export async function bindIdentity(redis: Redis, identity: UserIdentity): Promise<UserIdentity> {
  const key = KEYS.identity(identity.provider, identity.identifier)
  const existing = await getUserIdentity(redis, identity.provider, identity.identifier)
  if (existing && existing.userId !== identity.userId) throw new Error('Identity already bound to another account')
  const saved: UserIdentity = {
    ...existing,
    ...identity,
    credentialHash: identity.credentialHash ?? existing?.credentialHash,
    displayLabel: identity.displayLabel ?? existing?.displayLabel,
    verifiedAt: identity.verifiedAt ?? existing?.verifiedAt,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  }
  await redis.set(key, JSON.stringify(saved))
  const identities = (await listUserIdentities(redis, identity.userId))
    .filter((item) => !(item.provider === identity.provider && item.identifier === identity.identifier))
  identities.push(saved)
  await redis.del(KEYS.userIdentities(identity.userId))
  if (identities.length) {
    await redis.rpush(KEYS.userIdentities(identity.userId), ...identities.map((item) => JSON.stringify(item)))
  }
  return saved
}

export async function reassignIdentity(redis: Redis, identity: UserIdentity): Promise<UserIdentity> {
  const existing = await getUserIdentity(redis, identity.provider, identity.identifier)
  const saved: UserIdentity = {
    ...existing,
    ...identity,
    credentialHash: identity.credentialHash ?? existing?.credentialHash,
    displayLabel: identity.displayLabel ?? existing?.displayLabel,
    verifiedAt: identity.verifiedAt ?? existing?.verifiedAt,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  }
  await redis.set(KEYS.identity(saved.provider, saved.identifier), JSON.stringify(saved))
  const userIds = new Set([identity.userId, existing?.userId].filter(Boolean) as string[])
  for (const userId of userIds) {
    const identities = (await listUserIdentities(redis, userId))
      .filter((item) => !(item.provider === saved.provider && item.identifier === saved.identifier))
    if (userId === identity.userId) identities.push(saved)
    await redis.del(KEYS.userIdentities(userId))
    if (identities.length) {
      await redis.rpush(KEYS.userIdentities(userId), ...identities.map((item) => JSON.stringify(item)))
    }
  }
  return saved
}

export async function getUser(redis: Redis, userId: string): Promise<UserRecord | null> {
  const raw = await redis.get(KEYS.user(userId))
  return raw ? (JSON.parse(raw) as UserRecord) : null
}

export async function setUserKycOverride(
  redis: Redis,
  userId: string,
  doc: boolean | null,
  face: boolean | null,
): Promise<void> {
  const user = await getUser(redis, userId)
  if (!user) return
  user.kycDocOverride = doc
  user.kycFaceOverride = face
  await saveUser(redis, user)
}

export async function getUserByTelegramId(redis: Redis, tgId: number): Promise<UserRecord | null> {
  return getUserByIdentity(redis, 'telegram', String(tgId))
}

export async function getUserByInviteCode(redis: Redis, code: string): Promise<UserRecord | null> {
  const userId = await redis.get(KEYS.inviteCode(code))
  if (!userId) return null
  return getUser(redis, userId)
}

function applyTelegramProfile(user: UserRecord, input: {
  displayName: string
  avatarUrl?: string
}): void {
  user.displayName = input.displayName
  if (input.avatarUrl) user.avatarUrl = input.avatarUrl
}

export async function createUserFromTelegram(
  redis: Redis,
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
  const existing = await getUserByTelegramId(redis, input.telegramUserId)
  if (existing) {
    applyTelegramProfile(existing, input)
    await saveUser(redis, existing)
    await bindIdentity(redis, {
      userId: existing.id,
      provider: 'telegram',
      identifier: String(input.telegramUserId),
      displayLabel: input.telegramUsername,
      verifiedAt: nowIso(),
    })
    return { user: existing, isNewUser: false }
  }

  const id = await nextUserId(redis)
  let inviteCode = generateInviteCode()
  while (await redis.get(KEYS.inviteCode(inviteCode))) {
    inviteCode = generateInviteCode()
  }

  const user: UserRecord = {
    id,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    inviteCode,
    referredBy: input.referredBy,
    locale: 'en',
    status: 'active',
    registeredAt: nowIso(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  }
  await saveUser(redis, user)
  await bindIdentity(redis, {
    userId: user.id,
    provider: 'telegram',
    identifier: String(input.telegramUserId),
    displayLabel: input.telegramUsername,
    verifiedAt: nowIso(),
  })
  await redis.set(KEYS.wallet(id), JSON.stringify(defaultWallet()))
  return { user, isNewUser: true }
}

export async function getUserByTelegramOidcSub(redis: Redis, sub: string): Promise<UserRecord | null> {
  return getUserByIdentity(redis, 'telegram_oidc', sub)
}

export async function createUserFromTelegramOidc(
  redis: Redis,
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
  const existing = await getUserByTelegramOidcSub(redis, input.telegramOidcSub)
  if (existing) {
    existing.displayName = input.displayName
    if (input.avatarUrl) existing.avatarUrl = input.avatarUrl
    await saveUser(redis, existing)
    await bindIdentity(redis, {
      userId: existing.id,
      provider: 'telegram_oidc',
      identifier: input.telegramOidcSub,
      displayLabel: input.telegramUsername,
      verifiedAt: nowIso(),
    })
    return { user: existing, isNewUser: false }
  }

  const id = await nextUserId(redis)
  let inviteCode = generateInviteCode()
  while (await redis.get(KEYS.inviteCode(inviteCode))) {
    inviteCode = generateInviteCode()
  }

  const user: UserRecord = {
    id,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    referredBy: input.referredBy,
    registerIp: input.registerIp,
    registerRegion: input.registerRegion,
    inviteCode,
    locale: 'en',
    status: 'active',
    registeredAt: nowIso(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  }
  await saveUser(redis, user)
  await bindIdentity(redis, {
    userId: user.id,
    provider: 'telegram_oidc',
    identifier: input.telegramOidcSub,
    displayLabel: input.telegramUsername,
    verifiedAt: nowIso(),
  })
  await redis.set(KEYS.wallet(id), JSON.stringify(defaultWallet()))
  return { user, isNewUser: true }
}

export async function getUserByGoogleSub(redis: Redis, sub: string): Promise<UserRecord | null> {
  return getUserByIdentity(redis, 'google', sub)
}

export async function createUserFromGoogle(
  redis: Redis,
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
  const existing = await getUserByGoogleSub(redis, input.googleSub)
  if (existing) {
    existing.displayName = input.displayName
    if (input.avatarUrl) existing.avatarUrl = input.avatarUrl
    if (input.email) {
      existing.email = input.email
    }
    await saveUser(redis, existing)
    await bindIdentity(redis, {
      userId: existing.id,
      provider: 'google',
      identifier: input.googleSub,
      displayLabel: input.email,
      verifiedAt: nowIso(),
    })
    return { user: existing, isNewUser: false }
  }

  const id = await nextUserId(redis)
  let inviteCode = generateInviteCode()
  while (await redis.get(KEYS.inviteCode(inviteCode))) {
    inviteCode = generateInviteCode()
  }

  const user: UserRecord = {
    id,
    email: input.email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    inviteCode,
    locale: 'en',
    status: 'active',
    registeredAt: nowIso(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  }
  await saveUser(redis, user)
  await bindIdentity(redis, {
    userId: user.id,
    provider: 'google',
    identifier: input.googleSub,
    displayLabel: input.email,
    verifiedAt: nowIso(),
  })
  await redis.set(KEYS.wallet(id), JSON.stringify(defaultWallet()))
  return { user, isNewUser: true }
}

export async function getUserByPhoneAccount(redis: Redis, phone: string): Promise<UserRecord | null> {
  return getUserByIdentity(redis, 'phone', phone)
}

export async function getUserByEmail(redis: Redis, email: string): Promise<UserRecord | null> {
  const userId = await redis.get(KEYS.userByEmail(email))
  if (!userId) return null
  return getUser(redis, userId)
}

export async function createUserFromPassword(
  redis: Redis,
  input: {
    identifierType: 'phone'
    identifier: string
    passwordHash: string
    displayName: string
    referredBy?: string
    registerIp?: string
    registerRegion?: string
  },
): Promise<{ user: UserRecord; isNewUser: boolean }> {
  const id = await nextUserId(redis)
  let inviteCode = generateInviteCode()
  while (await redis.get(KEYS.inviteCode(inviteCode))) {
    inviteCode = generateInviteCode()
  }

  const user: UserRecord = {
    id,
    displayName: input.displayName,
    avatarUrl: undefined,
    inviteCode,
    referredBy: input.referredBy,
    locale: 'en',
    status: 'active',
    registerIp: input.registerIp,
    registerRegion: input.registerRegion,
    registeredAt: nowIso(),
    trialClaimed: false,
    referralClaimed: false,
    firstDepClaimed: false,
    referralReady: false,
    firstDepReady: false,
  }
  await saveUser(redis, user)
  await bindIdentity(redis, {
    userId: user.id,
    provider: input.identifierType,
    identifier: input.identifier,
    credentialHash: input.passwordHash,
    displayLabel: input.identifier,
    verifiedAt: nowIso(),
  })
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

// Lua 脚本：原子化完成 wallet 更新 + ledger 追加
// 解决两个问题：
//   1. TOCTOU 竞态 — GET/SET 之间无锁，并发请求会互相覆盖余额
//   2. 非原子性   — wallet 写入成功但 ledger LPUSH 失败时账务不一致
// KEYS[1]=wallet_key  KEYS[2]=ledger_key  ARGV[1]=cents  ARGV[2]=partial_entry_json
const CREDIT_LUA = `
local raw = redis.call('GET', KEYS[1])
local wallet
if raw == false then
  wallet = {available=0, frozen=0}
else
  wallet = cjson.decode(raw)
end
local cents = tonumber(ARGV[1])
local new_avail = (wallet['available'] or 0) + cents
wallet['available'] = new_avail
redis.call('SET', KEYS[1], cjson.encode(wallet))
local entry = cjson.decode(ARGV[2])
entry['amount'] = cents
entry['balanceAfter'] = new_avail
redis.call('LPUSH', KEYS[2], cjson.encode(entry))
return cjson.encode(wallet)
`

export async function creditWallet(
  redis: Redis,
  userId: string,
  cents: number,
  entry: Omit<LedgerEntry, 'id' | 'userId' | 'balanceAfter' | 'amount'>,
): Promise<WalletRecord> {
  const partialEntry = {
    id: `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    ...entry,
  }
  const result = await redis.eval(
    CREDIT_LUA,
    2,
    KEYS.wallet(userId),
    KEYS.ledger(userId),
    String(cents),
    JSON.stringify(partialEntry),
  ) as string
  return JSON.parse(result) as WalletRecord
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
  if (submission.phone && submission.phoneVerified) {
    await redis.set(KEYS.kycByPhone(submission.phone), submission.userId)
  }
  if (submission.extractedIdNo && submission.status === 'approved') {
    await redis.set(KEYS.kycByIdNo(submission.extractedIdNo), submission.userId)
  }
}

export async function findKycByVerifiedPhone(redis: Redis, phone: string, exceptUserId: string): Promise<string | null> {
  const owner = await redis.get(KEYS.kycByPhone(phone))
  return owner && owner !== exceptUserId ? owner : null
}

export async function findKycByExtractedIdNo(redis: Redis, idNo: string, exceptUserId: string): Promise<string | null> {
  const owner = await redis.get(KEYS.kycByIdNo(idNo))
  return owner && owner !== exceptUserId ? owner : null
}
