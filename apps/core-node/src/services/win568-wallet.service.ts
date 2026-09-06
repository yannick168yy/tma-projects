import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { lgId } from '../utils/id.js'
import { allocateBetTurnoverInTransaction, increaseBetTurnoverInTransaction, reverseBetTurnover } from './turnover.service.js'
import { getWin568SwCompanyKey } from './win568-key-settings.service.js'
import { DEFAULT_AGGREGATOR } from '../lib/aggregators.js'

type CallbackBody = Record<string, unknown>

// feature 彩金闸阈值：bff 写入 Redis（键 settings:feature_bonus_lock），这里带 30s 进程缓存读取，
// Redis 不可用时回落 env 默认。改后台系统参数即时生效（最多 30s 缓存延迟），无需重部署。
interface FeatureBonusLockCfg { enabled: boolean; minAmount: number; minAmountIdr: number; minMultiple: number; wagerMult: number }
const FL_REDIS_KEY = 'settings:feature_bonus_lock'
const FL_CACHE_MS = 30_000
let flCache: { v: FeatureBonusLockCfg; at: number } | null = null

interface PlayerRef {
  userId: string
  username: string
  currency: string
}

interface WalletRow extends RowDataPacket {
  available: string | number
}

interface TxnRow extends RowDataPacket {
  id: number
  user_id: string
  external_username: string
  currency: string
  transfer_code: string
  transaction_id: string
  product_type: number
  game_type: number
  gpid: number | null
  provider_id: string
  round_id: string | null
  txn_type: 'bet' | 'bonus'
  amount: string | number
  win_loss: string | number | null
  status: string
}

function text(body: CallbackBody, key: string): string {
  const value = body[key]
  return value === null || value === undefined ? '' : String(value)
}

function keyText(value: string): string {
  return value.replace(/\s+/g, '')
}

function num(body: CallbackBody, key: string): number {
  const value = Number(body[key] ?? 0)
  return Number.isFinite(value) ? value : 0
}

function int(body: CallbackBody, key: string): number {
  return Math.trunc(num(body, key))
}

function bool(body: CallbackBody, key: string): boolean {
  const value = body[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return Boolean(value)
}

function hasPromotionReward(extraInfo: unknown): boolean {
  if (!extraInfo || typeof extraInfo !== 'object' || Array.isArray(extraInfo)) return false
  return Object.entries(extraInfo as Record<string, unknown>).some(([key, value]) => (
    key.replace(/[_\s-]/g, '').toLowerCase().startsWith('promotionreward')
    && value !== null
    && value !== undefined
    && value !== ''
  ))
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function amountFactor(currency: string): number {
  return currency === 'IDR' ? 1000 : 1
}

function isDupEntry(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'ER_DUP_ENTRY'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ok(AccountName: string, Balance: number, extra: Record<string, unknown> = {}) {
  return { AccountName, Balance: round2(Balance), ErrorCode: 0, ErrorMessage: 'No Error', ...extra }
}

function err(ErrorCode: number, ErrorMessage: string, AccountName = '', Balance = 0, extra: Record<string, unknown> = {}) {
  return { AccountName, Balance: round2(Balance), ErrorCode, ErrorMessage, ...extra }
}

function isPrivatePeer(ip: string): boolean {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1'
}

function getClientIp(req: FastifyRequest): string {
  const peer = req.ip.replace(/^::ffff:/, '')
  // x-real-ip 只在请求来自内网反代（nginx）时可信，直连时防止伪造
  const realIp = req.headers['x-real-ip']
  if (isPrivatePeer(peer) && typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim().replace(/^::ffff:/, '')
  }
  return peer
}

function transferKey(body: CallbackBody): string {
  const transferCode = text(body, 'TransferCode')
  const transactionId = text(body, 'TransactionId')
  return transactionId ? `${transferCode}:${transactionId}` : transferCode
}

function statusText(status: string): string {
  return status.toLowerCase()
}

function walletCurrency(currency: string): string {
  return currency.toUpperCase() === 'UCC' ? 'USDT' : currency
}

export class Win568WalletService {
  constructor(private app: FastifyInstance) {}

  private get db() { return this.app.mysql }

  private toWalletAmount(player: PlayerRef, amount: number): number {
    return round2(amount * amountFactor(player.currency))
  }

  private toGameAmount(player: PlayerRef, amount: number): number {
    return round2(amount / amountFactor(player.currency))
  }

  private ok(player: PlayerRef, balance: number, extra: Record<string, unknown> = {}) {
    return ok(player.username, this.toGameAmount(player, balance), extra)
  }

  private err(code: number, message: string, player: PlayerRef, balance: number, extra: Record<string, unknown> = {}) {
    return err(code, message, player.username, this.toGameAmount(player, balance), extra)
  }

  private async validate(req: FastifyRequest, body: CallbackBody): Promise<{ code: number; message: string } | null> {
    // 生产环境 fail-closed：白名单/密钥未配置视为配置错误，直接拒绝，绝不裸奔
    const strict = env.NODE_ENV === 'production'
    const allowed = env.WIN568_SW_ALLOWED_IPS.split(',').map((ip) => ip.trim()).filter(Boolean)
    if (allowed.length === 0) {
      if (strict) {
        this.app.log.error('WIN568_SW_ALLOWED_IPS not configured, rejecting seamless wallet callback')
        return { code: 2, message: 'IP address not allowed' }
      }
    } else if (!allowed.includes(getClientIp(req))) {
      return { code: 2, message: 'IP address not allowed' }
    }
    const configuredKey = await getWin568SwCompanyKey(this.app)
    if (!configuredKey) {
      if (strict) {
        this.app.log.error('568win seamless wallet company key not configured, rejecting callback')
        return { code: 4, message: 'Company key is invalid' }
      }
    } else if (keyText(text(body, 'CompanyKey')) !== keyText(configuredKey)) {
      return { code: 4, message: 'Company key is invalid' }
    }
    return null
  }

  private async resolvePlayer(username: string): Promise<PlayerRef | null> {
    if (!username) return null
    const [[mapped]] = await this.db.query<RowDataPacket[]>(
      `SELECT ap.user_id, ap.external_username, ap.currency, u.status
       FROM bg_aggregator_player ap
       JOIN bg_user u ON u.id = ap.user_id
       WHERE ap.aggregator_id = '${DEFAULT_AGGREGATOR}' AND ap.external_username = ?
       LIMIT 1`,
      [username],
    )
    if (mapped) {
      if (mapped.status !== 'active') return null
      return { userId: String(mapped.user_id), username: String(mapped.external_username), currency: walletCurrency(String(mapped.currency || env.WIN568_DEFAULT_CURRENCY)) }
    }

    const [[user]] = await this.db.query<RowDataPacket[]>(
      `SELECT id, status FROM bg_user WHERE id = ? LIMIT 1`,
      [username],
    )
    if (!user || user.status !== 'active') return null
    return { userId: String(user.id), username, currency: walletCurrency(env.WIN568_DEFAULT_CURRENCY) }
  }

  private async ensureWallet(conn: PoolConnection, player: PlayerRef) {
    await conn.execute(
      `INSERT IGNORE INTO bg_wallet (user_id, currency, available, frozen, version)
       VALUES (?, ?, 0, 0, 0)`,
      [player.userId, player.currency],
    )
  }

  private async lockedBalance(conn: PoolConnection, player: PlayerRef): Promise<number> {
    await this.ensureWallet(conn, player)
    const [[wallet]] = await conn.query<WalletRow[]>(
      `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ? FOR UPDATE`,
      [player.userId, player.currency],
    )
    return Number(wallet?.available ?? 0)
  }

  private async currentBalance(conn: PoolConnection, player: PlayerRef): Promise<number> {
    const [[wallet]] = await conn.query<WalletRow[]>(
      `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
      [player.userId, player.currency],
    )
    return Number(wallet?.available ?? 0)
  }

  private async addLedger(conn: PoolConnection, player: PlayerRef, type: string, amount: number, balance: number, refId: string, description: string) {
    await conn.execute(
      `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
       VALUES (?, ?, ?, ?, ?, ?, 'game', ?, ?)`,
      [lgId(), player.userId, player.currency, type, round2(amount), round2(balance), refId, description],
    )
  }

  // 按 round_id 从 bg_bet_order 重算该局汇总，写入 bg_bet_round(读加速表)。
  // 派生数据：恒等于旧 /bets 分组结果；一局仅几行、走 (user_id, round_id) 索引，成本极低。
  private async refreshBetRound(conn: PoolConnection, userId: string, roundId: string): Promise<void> {
    if (!roundId) return
    await conn.execute(
      `INSERT INTO bg_bet_round (user_id, round_id, aggregator_id, provider_txn_id, bet_amount, win_amount, currency_code, first_at, last_id)
       SELECT user_id, round_id, MAX(aggregator_id),
         COALESCE(MAX(CASE WHEN bet_type = 'bet' THEN provider_txn_id END), MAX(provider_txn_id)),
         SUM(CASE WHEN bet_type = 'bet' THEN amount ELSE 0 END),
         SUM(CASE WHEN bet_type IN ('win', 'refund') THEN amount ELSE 0 END),
         MAX(currency_code), MIN(created_at), MAX(id)
       FROM bg_bet_order WHERE user_id = ? AND round_id = ? GROUP BY user_id, round_id
       ON DUPLICATE KEY UPDATE
         aggregator_id = VALUES(aggregator_id), provider_txn_id = VALUES(provider_txn_id),
         bet_amount = VALUES(bet_amount), win_amount = VALUES(win_amount),
         currency_code = VALUES(currency_code), first_at = VALUES(first_at), last_id = VALUES(last_id)`,
      [userId, roundId],
    )
  }

  private async changeBalance(conn: PoolConnection, player: PlayerRef, amount: number): Promise<number> {
    await conn.execute(
      `UPDATE bg_wallet SET available = ROUND(available + ?, 2), version = version + 1 WHERE user_id = ? AND currency = ?`,
      [round2(amount), player.userId, player.currency],
    )
    return this.currentBalance(conn, player)
  }

  private async findTxns(conn: PoolConnection, body: CallbackBody, opts: { lock?: boolean; singleNonVoid?: boolean } = {}): Promise<TxnRow[]> {
    const transferCode = text(body, 'TransferCode')
    const transactionId = text(body, 'TransactionId')
    const productType = int(body, 'ProductType')
    const suffix = opts.lock ? ' FOR UPDATE' : ''
    if (productType === 9 && transactionId) {
      const [rows] = await conn.query<TxnRow[]>(
        `SELECT * FROM bg_568win_wallet_txn WHERE transfer_code = ? AND transaction_id = ?${suffix}`,
        [transferCode, transactionId],
      )
      return rows
    }
    if (productType === 9 && !transactionId && opts.singleNonVoid) {
      const [rows] = await conn.query<TxnRow[]>(
        `SELECT * FROM bg_568win_wallet_txn
         WHERE transfer_code = ? AND status <> 'Void'
         ORDER BY created_at ASC LIMIT 1${suffix}`,
        [transferCode],
      )
      return rows
    }
    const [rows] = await conn.query<TxnRow[]>(
      `SELECT * FROM bg_568win_wallet_txn
       WHERE transfer_code = ?
       ORDER BY LOWER(status) = 'running' DESC, created_at ASC${suffix}`,
      [transferCode],
    )
    return rows
  }

  private async findAllByTransfer(conn: PoolConnection, transferCode: string, lock: boolean): Promise<TxnRow[]> {
    const suffix = lock ? ' FOR UPDATE' : ''
    const [rows] = await conn.query<TxnRow[]>(
      `SELECT * FROM bg_568win_wallet_txn WHERE transfer_code = ?${suffix}`,
      [transferCode],
    )
    return rows
  }

  private async finishRaiseDeduct(conn: PoolConnection, player: PlayerRef, body: CallbackBody, bet: TxnRow, amount: number, balance: number) {
    const transferCode = text(body, 'TransferCode')
    const oldAmount = Number(bet.amount)
    if (amount > oldAmount) {
      const diff = round2(amount - oldAmount)
      if (balance < diff) {
        await conn.commit()
        return this.err(5, 'Not enough balance', player, balance, { BetAmount: 0 })
      }
      const newBalance = await this.changeBalance(conn, player, -diff)
      await conn.execute(
        `UPDATE bg_568win_wallet_txn SET amount = ?, raw_request = ?, updated_at = NOW(3) WHERE id = ?`,
        [amount, JSON.stringify(body), bet.id],
      )
      await conn.execute(
        `UPDATE bg_bet_order SET amount = ?, original_amount = ? WHERE aggregator_id = '${DEFAULT_AGGREGATOR}' AND provider_txn_id = ? AND bet_type = 'bet'`,
        [amount, amount, transferKey(body)],
      )
      const [[order]] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM bg_bet_order WHERE aggregator_id = '${DEFAULT_AGGREGATOR}' AND provider_txn_id = ? AND bet_type = 'bet' LIMIT 1`,
        [transferKey(body)],
      )
      if (order) {
        await increaseBetTurnoverInTransaction(conn, player.userId, Number(order.id), diff,
          { gpid: body.Gpid === undefined ? null : int(body, 'Gpid'), gameId: body.GameId === undefined ? null : int(body, 'GameId') },
          player.currency)
      }
      await this.addLedger(conn, player, 'bet', -diff, newBalance, transferCode, '568Win raise bet')
      await this.refreshBetRound(conn, player.userId, text(body, 'GameRoundId') || transferCode)
      await conn.commit()
      return this.ok(player, newBalance, { BetAmount: this.toGameAmount(player, amount) })
    }
    await conn.commit()
    return this.err(amount < oldAmount ? 7 : 5003, amount < oldAmount ? 'Invalid raise amount' : 'Bet With Same RefNo Exists', player, balance, { BetAmount: 0 })
  }

  private async retryDuplicateRaiseDeduct(conn: PoolConnection, player: PlayerRef, body: CallbackBody) {
    const productType = int(body, 'ProductType')
    if (productType !== 3 && productType !== 7) return null
    await sleep(50)
    await conn.beginTransaction()
    try {
      const balance = await this.lockedBalance(conn, player)
      const existing = await this.findTxns(conn, body, { lock: true })
      if (existing.length === 0) {
        await conn.commit()
        return null
      }
      const bet = existing.find((row) => statusText(row.status) === 'running') ?? existing[0]
      const status = statusText(bet.status)
      const current = await this.currentBalance(conn, player)
      if (status === 'void' || status !== 'running') {
        await conn.commit()
        return this.err(5003, 'Bet With Same RefNo Exists', player, current, { BetAmount: 0 })
      }
      return this.finishRaiseDeduct(conn, player, body, bet, this.toWalletAmount(player, num(body, 'Amount')), balance)
    } catch (retryErr) {
      await conn.rollback()
      throw retryErr
    }
  }

  private async rollbackAlreadyApplied(conn: PoolConnection, player: PlayerRef, body: CallbackBody): Promise<number | null> {
    const bets = await this.findTxns(conn, body)
    if (!bets.some((b) => b.status === 'running' && b.win_loss !== null)) return null
    return this.currentBalance(conn, player)
  }

  private async cancelAlreadyApplied(conn: PoolConnection, player: PlayerRef, body: CallbackBody): Promise<number | null> {
    const bets = bool(body, 'IsCancelAll')
      ? await this.findAllByTransfer(conn, text(body, 'TransferCode'), false)
      : await this.findTxns(conn, body)
    if (bets.length === 0 || !bets.every((b) => b.status === 'Void')) return null
    return this.currentBalance(conn, player)
  }

  async getBalance(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')
    const [[wallet]] = await this.db.query<WalletRow[]>(
      `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
      [player.userId, player.currency],
    )
    return this.ok(player, Number(wallet?.available ?? 0))
  }

  async deduct(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.beginTransaction()
      const balance = await this.lockedBalance(conn, player)
      const amount = this.toWalletAmount(player, num(body, 'Amount'))
      const transferCode = text(body, 'TransferCode')
      const transactionId = text(body, 'TransactionId')
      const productType = int(body, 'ProductType')
      if (productType === 1 && amount === 0 && !hasPromotionReward(body.ExtraInfo)) {
        await conn.commit()
        return this.err(7, 'Invalid free bet amount', player, balance, { BetAmount: 0 })
      }
      if (productType === 9 && int(body, 'NewGameType') === 300 && amount === 0 && !hasPromotionReward(body.SeamlessGameExtraInfo)) {
        await conn.commit()
        return this.err(7, 'Invalid free bet amount', player, balance, { BetAmount: 0 })
      }
      const existing = await this.findTxns(conn, body, { lock: true })

      if (existing.length > 0) {
        const bet = productType === 3 || productType === 7
          ? existing.find((row) => statusText(row.status) === 'running') ?? existing[0]
          : existing[0]
        const status = statusText(bet.status)
        const current = await this.currentBalance(conn, player)
        if (productType === 9 || status === 'void' || status !== 'running') {
          await conn.commit()
          return this.err(5003, 'Bet With Same RefNo Exists', player, current, { BetAmount: 0 })
        }
        if (productType === 3 || productType === 7) {
          return this.finishRaiseDeduct(conn, player, body, bet, amount, balance)
        }
        await conn.commit()
        return this.err(5003, 'Bet With Same RefNo Exists', player, current, { BetAmount: 0 })
      }

      if (balance < amount) {
        await conn.commit()
        return this.err(5, 'Not enough balance', player, balance, { BetAmount: 0 })
      }

      const newBalance = await this.changeBalance(conn, player, -amount)
      await conn.execute(
        `INSERT INTO bg_568win_wallet_txn
         (user_id, external_username, currency, transfer_code, transaction_id, product_type, game_type, gpid, provider_id, round_id, txn_type, amount, status, raw_request)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bet', ?, 'running', ?)`,
        [
          player.userId, player.username, player.currency, transferCode, transactionId, productType, int(body, 'GameType'),
          body.Gpid === undefined ? null : int(body, 'Gpid'), String(body.GameId ?? body.Gpid ?? ''), text(body, 'GameRoundId') || null,
          amount, JSON.stringify(body),
        ],
      )
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO bg_bet_order
         (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status)
         VALUES (?, '${DEFAULT_AGGREGATOR}', ?, ?, ?, 'bet', ?, ?, ?, 1, 'pending')`,
        [player.userId, String(body.GameId ?? body.Gpid ?? ''), transferKey(body), text(body, 'GameRoundId') || transferCode, amount, player.currency, amount],
      )
      await allocateBetTurnoverInTransaction(conn, player.userId, Number(result.insertId), amount,
        { gpid: body.Gpid === undefined ? null : int(body, 'Gpid'), gameId: body.GameId === undefined ? null : int(body, 'GameId') },
        player.currency)
      await this.addLedger(conn, player, 'bet', -amount, newBalance, transferCode, '568Win deduct')
      await this.refreshBetRound(conn, player.userId, text(body, 'GameRoundId') || transferCode)
      await conn.commit()
      return this.ok(player, newBalance, { BetAmount: this.toGameAmount(player, amount) })
    } catch (e) {
      await conn.rollback()
      if (isDupEntry(e)) {
        const raised = await this.retryDuplicateRaiseDeduct(conn, player, body)
          .catch((retryErr) => {
            this.app.log.error({ err: retryErr }, '[568win] deduct duplicate raise retry failed')
            return null
          })
        if (raised) return raised
        const balance = await this.currentBalance(conn, player).catch(() => 0)
        return this.err(5003, 'Bet With Same RefNo Exists', player, balance, { BetAmount: 0 })
      }
      this.app.log.error({ err: e }, '[568win] deduct failed')
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  async returnStake(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.beginTransaction()
      await this.lockedBalance(conn, player)
      const bets = await this.findTxns(conn, body, { lock: true })
      if (bets.length === 0) {
        await conn.commit()
        return err(6, 'Bet not exists')
      }
      const bet = bets[0]
      const balance = await this.currentBalance(conn, player)
      if (bet.status !== 'running') {
        await conn.commit()
        if (bet.status === 'settled') return this.err(2001, 'Bet Already Settled', player, balance)
        if (bet.status === 'Void') return this.err(2002, 'Bet Already Canceled', player, balance)
        return this.err(7, 'Invalid bet state for return stake', player, balance)
      }

      const currentStake = this.toWalletAmount(player, num(body, 'CurrentStake'))
      const oldStake = round2(Number(bet.amount))
      if (currentStake === oldStake) {
        await conn.commit()
        return this.err(5003, 'Bet With Same RefNo Exists', player, balance)
      }
      if (currentStake > oldStake) {
        await conn.commit()
        return this.err(7, 'Invalid current stake', player, balance)
      }

      const refund = round2(oldStake - currentStake)
      const newBalance = refund > 0 ? await this.changeBalance(conn, player, refund) : balance
      if (refund > 0) {
        await conn.execute(
          `UPDATE bg_568win_wallet_txn SET amount = ?, raw_request = ?, updated_at = NOW(3) WHERE id = ?`,
          [currentStake, JSON.stringify(body), bet.id],
        )
        await conn.execute(
          `UPDATE bg_bet_order SET amount = ?, original_amount = ? WHERE aggregator_id = '${DEFAULT_AGGREGATOR}' AND provider_txn_id = ? AND bet_type = 'bet'`,
          [currentStake, currentStake, transferKey(body)],
        )
        await this.addLedger(conn, player, 'adjust', refund, newBalance, text(body, 'TransferCode'), '568Win return stake')
      }
      await this.refreshBetRound(conn, player.userId, bet.round_id ?? text(body, 'TransferCode'))
      await conn.commit()
      return this.ok(player, newBalance)
    } catch (e) {
      await conn.rollback()
      this.app.log.error({ err: e }, '[568win] return stake failed')
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  async settle(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.beginTransaction()
      await this.lockedBalance(conn, player)
      let bets = await this.findTxns(conn, body, { lock: true, singleNonVoid: true })
      if (bets.length === 0 && int(body, 'ProductType') === 9 && !text(body, 'TransactionId')) {
        const all = await this.findTxns(conn, body, { lock: true })
        if (all.some((b) => b.status === 'Void')) {
          const bal = await this.currentBalance(conn, player)
          await conn.commit()
          return this.err(2002, 'Bet Already Canceled', player, bal)
        }
      }
      if (bets.length === 0) {
        await conn.commit()
        return err(6, 'Bet not exists')
      }
      const bet = bets[0]
      const balance = await this.currentBalance(conn, player)
      if (bet.status === 'Void') {
        await conn.commit()
        return this.err(2002, 'Bet Already Canceled', player, balance)
      }
      if (bet.status === 'settled') {
        await conn.commit()
        return this.err(2001, 'Bet Already Settled', player, balance)
      }
      const winLoss = this.toWalletAmount(player, num(body, 'WinLoss'))
      const newBalance = await this.changeBalance(conn, player, winLoss)
      await conn.execute(
        `UPDATE bg_568win_wallet_txn
         SET status = 'settled', win_loss = ?, transaction_id = IF(transaction_id = '', ?, transaction_id), raw_request = ?, settled_at = NOW(3)
         WHERE id = ?`,
        [winLoss, text(body, 'TransactionId'), JSON.stringify(body), bet.id],
      )
      await conn.execute(
        `UPDATE bg_bet_order SET status = 'settled', settled_at = NOW(3)
         WHERE aggregator_id = '${DEFAULT_AGGREGATOR}' AND provider_txn_id = ? AND bet_type = 'bet'`,
        [bet.transaction_id ? `${bet.transfer_code}:${bet.transaction_id}` : bet.transfer_code],
      )
      await conn.execute(
        `INSERT IGNORE INTO bg_bet_order
         (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status, settled_at)
         VALUES (?, '${DEFAULT_AGGREGATOR}', ?, ?, ?, 'win', ?, ?, ?, 1, 'settled', NOW(3))`,
        [player.userId, text(body, 'GameCode') || bet.provider_id, `settle:${bet.id}`, bet.round_id ?? bet.transfer_code, winLoss, player.currency, winLoss],
      )
      await this.addLedger(conn, player, 'win', winLoss, newBalance, bet.transfer_code, '568Win settle')
      await this.refreshBetRound(conn, player.userId, bet.round_id ?? bet.transfer_code)
      await conn.commit()
      return this.ok(player, newBalance)
    } catch (e) {
      await conn.rollback()
      this.app.log.error({ err: e }, '[568win] settle failed')
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  async rollback(req: FastifyRequest, body: CallbackBody) {
    return this.reverse(req, body, 'rollback')
  }

  async cancel(req: FastifyRequest, body: CallbackBody) {
    return this.reverse(req, body, 'cancel')
  }

  private async reverse(req: FastifyRequest, body: CallbackBody, mode: 'rollback' | 'cancel') {
    const invalid = await this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.beginTransaction()
      await this.lockedBalance(conn, player)
      let bets: TxnRow[]
      if (mode === 'cancel' && bool(body, 'IsCancelAll')) {
        bets = await this.findAllByTransfer(conn, text(body, 'TransferCode'), true)
      } else if (mode === 'cancel' && !bool(body, 'IsCancelAll')) {
        if (!text(body, 'TransactionId')) {
          await conn.commit()
          return err(6, 'Bet not exists')
        }
        bets = await this.findTxns(conn, body, { lock: true })
      } else {
        bets = await this.findTxns(conn, body, { lock: true })
      }
      if (bets.length === 0) {
        await conn.commit()
        return err(6, 'Bet not exists')
      }

      const balance = await this.currentBalance(conn, player)
      if (mode === 'cancel' && bets.every((b) => b.status === 'Void')) {
        await conn.commit()
        return this.err(2002, 'Bet Already Canceled', player, balance)
      }
      if (mode === 'rollback') {
        const settledOrVoid = bets.filter((b) => b.status === 'settled' || b.status === 'Void')
        if (settledOrVoid.length === 0) {
          await conn.commit()
          return this.err(bets.some((b) => b.status === 'running' && b.win_loss !== null) ? 2003 : 7, bets.some((b) => b.status === 'running' && b.win_loss !== null) ? 'Bet Already Rollback' : 'Invalid Bet State For Rollback', player, balance)
        }
        bets = settledOrVoid
      }

      let adjustment = 0
      for (const bet of bets) {
        const amount = Number(bet.amount)
        const winLoss = Number(bet.win_loss ?? 0)
        if (mode === 'rollback') {
          adjustment += bet.status === 'settled'
            ? -winLoss
            : (bet.txn_type === 'bonus' ? amount : -amount)
          await conn.execute(
            `UPDATE bg_568win_wallet_txn SET status = 'running', settled_at = NULL, updated_at = NOW(3) WHERE id = ?`,
            [bet.id],
          )
        } else if (bet.status !== 'Void') {
          if (bet.txn_type === 'bonus' && bet.status === 'settled') adjustment -= amount
          else if (bet.status === 'settled') adjustment += -winLoss + amount
          else adjustment += amount
          await conn.execute(
            `UPDATE bg_568win_wallet_txn SET status = 'Void', voided_at = NOW(3), updated_at = NOW(3) WHERE id = ?`,
            [bet.id],
          )
        }
      }

      const newBalance = await this.changeBalance(conn, player, adjustment)
      // 冲正行归入原注单的 round_id(而非另起一个 TransferCode 局)，使 cancel/rollback 与其 bet/win
      // 聚合到同一局。bets[0].round_id(wallet_txn.round_id)?? TransferCode 精确等于原 bg_bet_order.round_id。
      const reverseRoundId = bets[0].round_id ?? text(body, 'TransferCode')
      await conn.execute(
        `INSERT IGNORE INTO bg_bet_order
         (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status, settled_at)
         VALUES (?, '${DEFAULT_AGGREGATOR}', ?, ?, ?, ?, ?, ?, ?, 1, 'settled', NOW(3))`,
        [player.userId, String(body.GameId ?? body.Gpid ?? ''), `${mode}:${transferKey(body)}`, reverseRoundId, mode === 'cancel' ? 'cancel' : 'refund', adjustment, player.currency, adjustment],
      )
      await this.addLedger(conn, player, adjustment >= 0 ? 'adjust' : 'bet', adjustment, newBalance, text(body, 'TransferCode'), `568Win ${mode}`)
      // 派彩已被冲正收回，对应的 feature 彩金流水锁一并作废，避免玩家被无故压流水；已打满的(completed)不动
      await conn.execute(
        `UPDATE bg_turnover_requirements SET status = 'cancelled', updated_at = NOW()
         WHERE user_id = ? AND status = 'pending' AND source_type = 'promotion' AND source_ref = ?`,
        [player.userId, `feature_bonus:${text(body, 'TransferCode')}`],
      )
      await this.refreshBetRound(conn, player.userId, reverseRoundId)
      await conn.commit()
      if (mode === 'rollback') {
        reverseBetTurnover(this.db, player.userId, text(body, 'TransferCode')).catch((rollbackErr) => {
          this.app.log.error({ err: rollbackErr }, '[568win] reverse turnover failed')
        })
      }
      return this.ok(player, newBalance)
    } catch (e) {
      await conn.rollback()
      if (mode === 'rollback') {
        for (let i = 0; i < 5; i += 1) {
          const balance = await this.rollbackAlreadyApplied(conn, player, body).catch(() => null)
          if (balance !== null) return this.err(2003, 'Bet Already Rollback', player, balance)
          if (i < 4) await sleep(50)
        }
      } else {
        for (let i = 0; i < 5; i += 1) {
          const balance = await this.cancelAlreadyApplied(conn, player, body).catch(() => null)
          if (balance !== null) return this.err(2002, 'Bet Already Canceled', player, balance)
          if (i < 4) await sleep(50)
        }
      }
      this.app.log.error({ err: e }, `[568win] ${mode} failed`)
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  private async getFeatureBonusLockConfig(): Promise<FeatureBonusLockCfg> {
    const now = Date.now()
    if (flCache && now - flCache.at < FL_CACHE_MS) return flCache.v
    const v: FeatureBonusLockCfg = {
      enabled: env.FEATURE_BONUS_LOCK_ENABLED === 'true',
      minAmount: env.FEATURE_BONUS_LOCK_MIN_AMOUNT,
      minAmountIdr: env.FEATURE_BONUS_LOCK_MIN_AMOUNT_IDR,
      minMultiple: env.FEATURE_BONUS_LOCK_MIN_MULTIPLE,
      wagerMult: env.FEATURE_BONUS_LOCK_WAGER_MULT,
    }
    try {
      const raw = await this.app.redis.get(FL_REDIS_KEY)
      if (raw) {
        const j = JSON.parse(raw) as Partial<FeatureBonusLockCfg>
        if (typeof j.enabled === 'boolean') v.enabled = j.enabled
        if (Number.isFinite(j.minAmount)) v.minAmount = Number(j.minAmount)
        if (Number.isFinite(j.minAmountIdr)) v.minAmountIdr = Number(j.minAmountIdr)
        if (Number.isFinite(j.minMultiple)) v.minMultiple = Number(j.minMultiple)
        if (Number.isFinite(j.wagerMult)) v.wagerMult = Number(j.wagerMult)
      }
    } catch {
      /* Redis 不可用 → 用 env 默认，不影响派彩 */
    }
    flCache = { v, at: now }
    return v
  }

  // feature/免费旋转彩金薅羊毛闸：非平台活动派彩(IsGameProviderPromotion=false)中，
  // 单笔派彩相对触发注达到高倍(小注爆奖=farming 签名)时，按倍数补一条同额彩金流水锁，
  // 打满才可提。巨鲸大奖与正常小奖都是低倍，天然不受影响。
  // 只挂 /Bonus 通道：普通结算中奖是玩家自己赢的钱，由提现审核规则把关，不在这里压流水。
  private async maybeLockFeatureBonus(
    conn: PoolConnection, player: PlayerRef, body: CallbackBody, amount: number,
  ): Promise<void> {
    const cfg = await this.getFeatureBonusLockConfig()
    if (!cfg.enabled) return
    if (bool(body, 'IsGameProviderPromotion')) return
    // 阈值必须按币种取：amount 是钱包单位（IDR 即实际卢比），共用 PHP 的门槛
    // 会让每一笔 IDR 彩金都越过闸门，白白给玩家压上流水锁
    const minAmount = player.currency === 'IDR' ? cfg.minAmountIdr : cfg.minAmount
    if (amount < minAmount) return
    const extra = body.SeamlessGameExtraInfo as Record<string, unknown> | undefined
    const refNo = extra && typeof extra.ReferenceRefNo === 'string' ? extra.ReferenceRefNo : ''
    if (!refNo) return
    const [betRows] = await conn.query<RowDataPacket[]>(
      `SELECT amount FROM bg_568win_wallet_txn WHERE transfer_code = ? AND txn_type = 'bet' ORDER BY id DESC LIMIT 1`,
      [refNo],
    )
    const betAmount = betRows[0] ? Number(betRows[0].amount) : 0
    if (betAmount <= 0 || amount / betAmount < cfg.minMultiple) return
    const required = round2(amount * cfg.wagerMult)
    await conn.execute(
      `INSERT IGNORE INTO bg_turnover_requirements
         (user_id, currency, source_type, source_ref, base_amount, required_amount)
       VALUES (?, ?, 'promotion', ?, ?, ?)`,
      [player.userId, player.currency, `feature_bonus:${text(body, 'TransferCode')}`, amount, required],
    )
    this.app.log.info(
      { userId: player.userId, amount, betAmount, multiple: round2(amount / betAmount), required },
      '[568win] feature bonus wagering lock applied',
    )
  }

  // PG 等游戏的真实派彩走 /Bonus(BetPayout)通道:原逻辑只加钱到钱包、不写 bg_bet_order，
  // 导致客户端投注记录里这一局只显示下注、赢钱恒为 0（20+万 PHP 派彩在展示层被吞）。
  // 这里按母注单 round 补一条 win 行并重算 bet_round，使派彩正常体现在投注记录里。
  // 归局键:body 无 GameRoundId，用 SeamlessGameExtraInfo.ReferenceRefNo（母 bet 的 TransferCode）
  // 反查母 bet 的 round_id，与 deduct 写入 bg_bet_order.round_id 精确一致。
  private async linkBonusToRound(
    conn: PoolConnection, player: PlayerRef, body: CallbackBody, amount: number,
  ): Promise<void> {
    if (amount <= 0) return
    const extra = body.SeamlessGameExtraInfo as Record<string, unknown> | undefined
    const refNo = extra && typeof extra.ReferenceRefNo === 'string' ? extra.ReferenceRefNo : ''
    if (!refNo) return
    const [betRows] = await conn.query<RowDataPacket[]>(
      `SELECT round_id, provider_id FROM bg_568win_wallet_txn
       WHERE transfer_code = ? AND txn_type = 'bet' ORDER BY id DESC LIMIT 1`,
      [refNo],
    )
    if (!betRows[0]) return
    // deduct 写 wallet_txn.round_id = GameRoundId、bet_order.round_id = GameRoundId||transferCode；
    // GameRoundId 存在时两者相等，为空时回退到母 bet 的 TransferCode(= refNo)。
    const roundId = betRows[0].round_id ? String(betRows[0].round_id) : refNo
    await conn.execute(
      `INSERT IGNORE INTO bg_bet_order
       (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status, settled_at)
       VALUES (?, '${DEFAULT_AGGREGATOR}', ?, ?, ?, 'win', ?, ?, ?, 1, 'settled', NOW(3))`,
      [
        player.userId, String(betRows[0].provider_id ?? body.GameId ?? ''),
        `bonus:${text(body, 'TransferCode')}`, roundId, amount, player.currency, amount,
      ],
    )
    await this.refreshBetRound(conn, player.userId, roundId)
  }

  async bonus(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.beginTransaction()
      const balance = await this.lockedBalance(conn, player)
      const existing = await this.findAllByTransfer(conn, text(body, 'TransferCode'), true)
      if (existing.length > 0) {
        await conn.commit()
        return this.err(5003, 'Bet With Same RefNo Exists', player, balance)
      }
      const amount = this.toWalletAmount(player, num(body, 'Amount'))
      const newBalance = await this.changeBalance(conn, player, amount)
      await conn.execute(
        `INSERT INTO bg_568win_wallet_txn
         (user_id, external_username, currency, transfer_code, transaction_id, product_type, game_type, gpid, provider_id, round_id, txn_type, amount, status, raw_request, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bonus', ?, 'settled', ?, NOW(3))`,
        [
          player.userId, player.username, player.currency, text(body, 'TransferCode'), text(body, 'TransactionId'),
          int(body, 'ProductType'), int(body, 'GameType'), body.Gpid === undefined ? null : int(body, 'Gpid'),
          String(body.GameId ?? body.Gpid ?? ''), text(body, 'TransferCode'), amount, JSON.stringify(body),
        ],
      )
      await this.addLedger(conn, player, 'bonus', amount, newBalance, text(body, 'TransferCode'), '568Win bonus')
      await this.maybeLockFeatureBonus(conn, player, body, amount)
      await this.linkBonusToRound(conn, player, body, amount)
      await conn.commit()
      return this.ok(player, newBalance)
    } catch (e) {
      await conn.rollback()
      if (isDupEntry(e)) {
        const balance = await this.currentBalance(conn, player).catch(() => 0)
        return this.err(5003, 'Bet With Same RefNo Exists', player, balance)
      }
      this.app.log.error({ err: e }, '[568win] bonus failed')
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  async getBetStatus(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req, body)
    if (invalid) return { TransferCode: '', TransactionId: '', Status: '', WinLoss: 0, Stake: 0, ErrorCode: invalid.code, ErrorMessage: invalid.message }
    if (!text(body, 'Username')) return { TransferCode: '', TransactionId: '', Status: '', WinLoss: 0, Stake: 0, ErrorCode: 3, ErrorMessage: 'Username empty' }
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return { TransferCode: '', TransactionId: '', Status: '', WinLoss: 0, Stake: 0, ErrorCode: 1, ErrorMessage: 'Member does not exist' }

    const conn = await this.db.getConnection()
    try {
      const bets = await this.findTxns(conn, body)
      if (bets.length === 0) return { TransferCode: text(body, 'TransferCode'), TransactionId: text(body, 'TransactionId'), Status: '', WinLoss: 0, Stake: 0, ErrorCode: 6, ErrorMessage: 'Bet not exists' }
      const bet = bets[0]
      const status = bet.status.toLowerCase()
      return {
        TransferCode: bet.transfer_code,
        TransactionId: bet.transaction_id,
        Status: status,
        WinLoss: status === 'settled' ? this.toGameAmount(player, Number(bet.win_loss ?? 0)) : 0,
        Stake: this.toGameAmount(player, Number(bet.amount)),
        ErrorCode: 0,
        ErrorMessage: 'No Error',
      }
    } catch (e) {
      this.app.log.error({ err: e }, '[568win] get bet status failed')
      return { TransferCode: '', TransactionId: '', Status: '', WinLoss: 0, Stake: 0, ErrorCode: 7, ErrorMessage: 'Internal error' }
    } finally {
      conn.release()
    }
  }
}
