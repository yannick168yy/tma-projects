import type { Redis } from 'ioredis'
import type { Env } from '../../config/env.js'
import { isMysqlEnabled } from '../../clients/mysql.client.js'
import * as redisStore from './redis-store.js'
import * as mysqlStore from './mysql-store.js'
import type {
  OrderDeposit,
  OrderWithdraw,
  IdentityProvider,
  KycSubmission,
  LedgerEntry,
  SessionRecord,
  UserIdentity,
  UserRecord,
  WalletRecord,
  WalletBalance,
} from '../../types/domain.js'

// backward-compat type aliases
type DepositOrder = OrderDeposit
type WithdrawOrder = OrderWithdraw

let appEnv: Env | null = null

export function initStore(env: Env): void {
  appEnv = env
}

function env(): Env {
  if (!appEnv) throw new Error('store not initialized — call initStore(env) at startup')
  return appEnv
}

export const saveUser = (redis: Redis, user: UserRecord) =>
  isMysqlEnabled(env()) ? mysqlStore.saveUser(env(), user) : redisStore.saveUser(redis, user)

export const getUser = (redis: Redis, userId: string) =>
  isMysqlEnabled(env()) ? mysqlStore.getUser(env(), userId) : redisStore.getUser(redis, userId)

export const listUserIdentities = (redis: Redis, userId: string): Promise<UserIdentity[]> =>
  isMysqlEnabled(env()) ? mysqlStore.listUserIdentities(env(), userId) : redisStore.listUserIdentities(redis, userId)

export const getUserIdentity = (redis: Redis, provider: IdentityProvider, identifier: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserIdentity(env(), provider, identifier)
    : redisStore.getUserIdentity(redis, provider, identifier)

export const getUserByIdentity = (redis: Redis, provider: IdentityProvider, identifier: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByIdentity(env(), provider, identifier)
    : redisStore.getUserByIdentity(redis, provider, identifier)

export const bindIdentity = (redis: Redis, identity: UserIdentity) =>
  isMysqlEnabled(env()) ? mysqlStore.bindIdentity(env(), identity) : redisStore.bindIdentity(redis, identity)

export const setUserKycOverride = (redis: Redis, userId: string, doc: boolean | null, face: boolean | null) =>
  isMysqlEnabled(env())
    ? mysqlStore.setUserKycOverride(env(), userId, doc, face)
    : redisStore.setUserKycOverride(redis, userId, doc, face)

export const getUserByTelegramId = (redis: Redis, tgId: number) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByTelegramId(env(), tgId)
    : redisStore.getUserByTelegramId(redis, tgId)

export const getUserByInviteCode = (redis: Redis, code: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByInviteCode(env(), code)
    : redisStore.getUserByInviteCode(redis, code)

export const createUserFromTelegram = (
  redis: Redis,
  input: Parameters<typeof redisStore.createUserFromTelegram>[1],
) =>
  isMysqlEnabled(env())
    ? mysqlStore.createUserFromTelegram(env(), input)
    : redisStore.createUserFromTelegram(redis, input)

export const getUserByTelegramOidcSub = (redis: Redis, sub: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByTelegramOidcSub(env(), sub)
    : redisStore.getUserByTelegramOidcSub(redis, sub)

export const getUserByGoogleSub = (redis: Redis, sub: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByGoogleSub(env(), sub)
    : redisStore.getUserByGoogleSub(redis, sub)

export const getUserByUsername = (redis: Redis, username: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByUsername(env(), username)
    : redisStore.getUserByUsername(redis, username)

export const getUserByPhoneAccount = (redis: Redis, phone: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByPhoneAccount(env(), phone)
    : redisStore.getUserByPhoneAccount(redis, phone)

export const getUserByEmail = (redis: Redis, email: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByEmail(env(), email)
    : redisStore.getUserByEmail(redis, email)

export const createUserFromPassword = (
  redis: Redis,
  input: Parameters<typeof redisStore.createUserFromPassword>[1],
) =>
  isMysqlEnabled(env())
    ? mysqlStore.createUserFromPassword(env(), input)
    : redisStore.createUserFromPassword(redis, input)

export const createUserFromGoogle = (
  redis: Redis,
  input: Parameters<typeof redisStore.createUserFromGoogle>[1],
) =>
  isMysqlEnabled(env())
    ? mysqlStore.createUserFromGoogle(env(), input)
    : redisStore.createUserFromGoogle(redis, input)

export const createUserFromTelegramOidc = (
  redis: Redis,
  input: Parameters<typeof redisStore.createUserFromTelegramOidc>[1],
) =>
  isMysqlEnabled(env())
    ? mysqlStore.createUserFromTelegramOidc(env(), input)
    : redisStore.createUserFromTelegramOidc(redis, input)

export const createDevUser = (redis: Redis) =>
  isMysqlEnabled(env()) ? mysqlStore.createDevUser(env()) : redisStore.createDevUser(redis)

export const saveSession = redisStore.saveSession
export const getSession = redisStore.getSession
export const deleteSession = redisStore.deleteSession

export const getWallet = (redis: Redis, userId: string) =>
  isMysqlEnabled(env()) ? mysqlStore.getWallet(env(), userId) : redisStore.getWallet(redis, userId)

export const getWalletBalances = (_redis: Redis, userId: string): Promise<WalletBalance[]> =>
  isMysqlEnabled(env()) ? mysqlStore.getWalletBalances(env(), userId) : Promise.resolve([])

export const saveWallet = (redis: Redis, userId: string, wallet: WalletRecord) =>
  isMysqlEnabled(env())
    ? Promise.resolve()
    : redisStore.saveWallet(redis, userId, wallet)

export const creditWallet = (
  redis: Redis,
  userId: string,
  cents: number,
  entry: Omit<LedgerEntry, 'id' | 'userId' | 'balanceAfter' | 'amount'>,
) =>
  isMysqlEnabled(env())
    ? mysqlStore.creditWallet(env(), userId, cents, entry)
    : redisStore.creditWallet(redis, userId, cents, entry)

export const appendLedger = (
  redis: Redis,
  userId: string,
  partial: Omit<LedgerEntry, 'id' | 'userId'>,
) =>
  isMysqlEnabled(env())
    ? mysqlStore.listLedger(env(), userId, 1).then(() => {
        throw new Error('use creditWallet for mysql ledger append')
      })
    : redisStore.appendLedger(redis, userId, partial)

export const listLedger = (redis: Redis, userId: string, limit = 50) =>
  isMysqlEnabled(env())
    ? mysqlStore.listLedger(env(), userId, limit)
    : redisStore.listLedger(redis, userId, limit)

export const getLedgerEntry = (redis: Redis, userId: string, id: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getLedgerEntry(env(), userId, id)
    : redisStore.getLedgerEntry(redis, userId, id)

export const saveDeposit = (redis: Redis, order: DepositOrder) =>
  isMysqlEnabled(env())
    ? mysqlStore.saveDeposit(env(), order)
    : redisStore.saveDeposit(redis, order)

export const getDeposit = (redis: Redis, orderId: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getDeposit(env(), orderId)
    : redisStore.getDeposit(redis, orderId)

export const listDeposits = (redis: Redis, userId: string, page = 1, pageSize = 20) =>
  isMysqlEnabled(env())
    ? mysqlStore.listDeposits(env(), userId, page, pageSize)
    : redisStore.listDeposits(redis, userId, page, pageSize)

export const saveWithdraw = (redis: Redis, order: WithdrawOrder) =>
  isMysqlEnabled(env())
    ? mysqlStore.saveWithdraw(env(), order)
    : redisStore.saveWithdraw(redis, order)

export const getWithdraw = (redis: Redis, orderId: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getWithdraw(env(), orderId)
    : redisStore.getWithdraw(redis, orderId)

export const listWithdrawals = (redis: Redis, userId: string, page = 1, pageSize = 20) =>
  isMysqlEnabled(env())
    ? mysqlStore.listWithdrawals(env(), userId, page, pageSize)
    : redisStore.listWithdrawals(redis, userId, page, pageSize)

export const recordUserLogin = (
  redis: Redis,
  userId: string,
  opts: { ip?: string; region?: string; userAgent?: string; authMethod?: string },
) =>
  isMysqlEnabled(env())
    ? mysqlStore.recordUserLogin(env(), userId, opts)
    : Promise.resolve()

export const adminAdjustBalance = (
  _redis: Redis,
  userId: string,
  cents: number,
  opts: { adminUsername: string; note?: string; traceId?: string; currency?: string },
) =>
  isMysqlEnabled(env())
    ? mysqlStore.adminAdjustBalance(env(), userId, cents, opts)
    : Promise.resolve({ available: 0, orderId: 'MOCK' })

export const getKyc = (redis: Redis, userId: string) =>
  isMysqlEnabled(env()) ? mysqlStore.getKyc(env(), userId) : redisStore.getKyc(redis, userId)

export const saveKyc = (redis: Redis, submission: KycSubmission) =>
  isMysqlEnabled(env()) ? mysqlStore.saveKyc(env(), submission) : redisStore.saveKyc(redis, submission)

export const findKycByVerifiedPhone = (redis: Redis, phone: string, exceptUserId: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.findKycByVerifiedPhone(env(), phone, exceptUserId)
    : redisStore.findKycByVerifiedPhone(redis, phone, exceptUserId)

export const findKycByExtractedIdNo = (redis: Redis, idNo: string, exceptUserId: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.findKycByExtractedIdNo(env(), idNo, exceptUserId)
    : redisStore.findKycByExtractedIdNo(redis, idNo, exceptUserId)

export const saveOrderDeposit = (_redis: Redis, order: OrderDeposit) =>
  isMysqlEnabled(env()) ? mysqlStore.saveOrderDeposit(env(), order) : Promise.resolve()

export const getOrderDeposit = (_redis: Redis, orderId: string) =>
  isMysqlEnabled(env()) ? mysqlStore.getOrderDeposit(env(), orderId) : Promise.resolve(null)

export const listOrderDeposits = (_redis: Redis, userId: string, page = 1, pageSize = 20) =>
  isMysqlEnabled(env()) ? mysqlStore.listOrderDeposits(env(), userId, page, pageSize) : Promise.resolve([] as OrderDeposit[])

export const saveOrderWithdraw = (_redis: Redis, order: OrderWithdraw) =>
  isMysqlEnabled(env()) ? mysqlStore.saveOrderWithdraw(env(), order) : Promise.resolve()

export const getOrderWithdraw = (_redis: Redis, orderId: string) =>
  isMysqlEnabled(env()) ? mysqlStore.getOrderWithdraw(env(), orderId) : Promise.resolve(null)

export const listOrderWithdrawals = (_redis: Redis, userId: string, page = 1, pageSize = 20) =>
  isMysqlEnabled(env()) ? mysqlStore.listOrderWithdrawals(env(), userId, page, pageSize) : Promise.resolve([] as OrderWithdraw[])
