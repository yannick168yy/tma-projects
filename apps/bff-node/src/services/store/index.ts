import type { Redis } from 'ioredis'
import type { Env } from '../../config/env.js'
import { isMysqlEnabled } from '../../clients/mysql.client.js'
import * as redisStore from './redis-store.js'
import * as mysqlStore from './mysql-store.js'
import type {
  OrderDeposit,
  OrderWithdraw,
  KycSubmission,
  LedgerEntry,
  SessionRecord,
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

export const getUserByGoogleSub = (redis: Redis, sub: string) =>
  isMysqlEnabled(env())
    ? mysqlStore.getUserByGoogleSub(env(), sub)
    : redisStore.getUserByGoogleSub(redis, sub)

export const createUserFromGoogle = (
  redis: Redis,
  input: Parameters<typeof redisStore.createUserFromGoogle>[1],
) =>
  isMysqlEnabled(env())
    ? mysqlStore.createUserFromGoogle(env(), input)
    : redisStore.createUserFromGoogle(redis, input)

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
  opts: { adminUsername: string; note?: string; traceId?: string },
) =>
  isMysqlEnabled(env())
    ? mysqlStore.adminAdjustBalance(env(), userId, cents, opts)
    : Promise.resolve({ available: 0, orderId: 'MOCK' })

export const getKyc = (redis: Redis, userId: string) =>
  isMysqlEnabled(env()) ? mysqlStore.getKyc(env(), userId) : redisStore.getKyc(redis, userId)

export const saveKyc = (redis: Redis, submission: KycSubmission) =>
  isMysqlEnabled(env()) ? mysqlStore.saveKyc(env(), submission) : redisStore.saveKyc(redis, submission)

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
