import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { lgId } from '../utils/id.js'
import { allocateBetTurnoverInTransaction, reverseBetTurnover } from './turnover.service.js'

type CallbackBody = Record<string, unknown>

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
  transaction_id: string | null
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

function ok(AccountName: string, Balance: number, extra: Record<string, unknown> = {}) {
  return { AccountName, Balance: round2(Balance), ErrorCode: 0, ErrorMessage: 'No Error', ...extra }
}

function err(ErrorCode: number, ErrorMessage: string, AccountName = '', Balance = 0, extra: Record<string, unknown> = {}) {
  return { AccountName, Balance: round2(Balance), ErrorCode, ErrorMessage, ...extra }
}

function getClientIp(req: FastifyRequest): string {
  const realIp = req.headers['x-real-ip']
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim().replace(/^::ffff:/, '')
  return req.ip.replace(/^::ffff:/, '')
}

function transferKey(body: CallbackBody): string {
  const transferCode = text(body, 'TransferCode')
  const transactionId = text(body, 'TransactionId')
  return transactionId ? `${transferCode}:${transactionId}` : transferCode
}

export class Win568WalletService {
  constructor(private app: FastifyInstance) {}

  private get db() { return this.app.mysql }

  private validate(req: FastifyRequest, body: CallbackBody): { code: number; message: string } | null {
    const allowed = env.WIN568_SW_ALLOWED_IPS.split(',').map((ip) => ip.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(getClientIp(req))) {
      return { code: 2, message: 'IP address not allowed' }
    }
    const configuredKey = env.WIN568_SW_COMPANY_KEY.trim()
    if (configuredKey && text(body, 'CompanyKey') !== configuredKey) {
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
       WHERE ap.aggregator_id = '568win' AND ap.external_username = ?
       LIMIT 1`,
      [username],
    )
    if (mapped) {
      if (mapped.status !== 'active') return null
      return { userId: String(mapped.user_id), username: String(mapped.external_username), currency: String(mapped.currency || env.WIN568_DEFAULT_CURRENCY) }
    }

    const [[user]] = await this.db.query<RowDataPacket[]>(
      `SELECT id, status FROM bg_user WHERE id = ? LIMIT 1`,
      [username],
    )
    if (!user || user.status !== 'active') return null
    return { userId: String(user.id), username, currency: env.WIN568_DEFAULT_CURRENCY }
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

  private async changeBalance(conn: PoolConnection, player: PlayerRef, amount: number): Promise<number> {
    await conn.execute(
      `UPDATE bg_wallet SET available = ROUND(available + ?, 2), version = version + 1 WHERE user_id = ? AND currency = ?`,
      [round2(amount), player.userId, player.currency],
    )
    return this.currentBalance(conn, player)
  }

  private async findTxns(conn: PoolConnection, body: CallbackBody, lock: boolean): Promise<TxnRow[]> {
    const transferCode = text(body, 'TransferCode')
    const transactionId = text(body, 'TransactionId')
    const productType = int(body, 'ProductType')
    const suffix = lock ? ' FOR UPDATE' : ''
    if (productType === 9 && transactionId) {
      const [rows] = await conn.query<TxnRow[]>(
        `SELECT * FROM bg_568win_wallet_txn WHERE transfer_code = ? AND transaction_id = ?${suffix}`,
        [transferCode, transactionId],
      )
      return rows
    }
    if (productType === 9 && !transactionId && (body.__singleNonVoid === true)) {
      const [rows] = await conn.query<TxnRow[]>(
        `SELECT * FROM bg_568win_wallet_txn
         WHERE transfer_code = ? AND status <> 'Void'
         ORDER BY created_at ASC LIMIT 1${suffix}`,
        [transferCode],
      )
      return rows
    }
    const [rows] = await conn.query<TxnRow[]>(
      `SELECT * FROM bg_568win_wallet_txn WHERE transfer_code = ?${suffix}`,
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

  async getBalance(req: FastifyRequest, body: CallbackBody) {
    const invalid = this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')
    const [[wallet]] = await this.db.query<WalletRow[]>(
      `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
      [player.userId, player.currency],
    )
    return ok(player.username, Number(wallet?.available ?? 0))
  }

  async deduct(req: FastifyRequest, body: CallbackBody) {
    const invalid = this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
      await conn.beginTransaction()
      const balance = await this.lockedBalance(conn, player)
      const amount = round2(num(body, 'Amount'))
      const transferCode = text(body, 'TransferCode')
      const transactionId = text(body, 'TransactionId') || null
      const productType = int(body, 'ProductType')
      if (productType === 1 && amount === 0 && !hasPromotionReward(body.ExtraInfo)) {
        await conn.commit()
        return err(7, 'Invalid free bet amount', player.username, balance, { BetAmount: 0 })
      }
      if (productType === 9 && int(body, 'NewGameType') === 300 && amount === 0 && !hasPromotionReward(body.SeamlessGameExtraInfo)) {
        await conn.commit()
        return err(7, 'Invalid free bet amount', player.username, balance, { BetAmount: 0 })
      }
      const existing = productType === 9
        ? await this.findTxns(conn, body, true)
        : await this.findTxns(conn, body, true)

      if (existing.length > 0) {
        const bet = existing[0]
        const current = await this.currentBalance(conn, player)
        if (productType === 9 || bet.status === 'Void' || bet.status !== 'running') {
          await conn.commit()
          return err(5003, 'Bet With Same RefNo Exists', player.username, current, { BetAmount: 0 })
        }
        const oldAmount = Number(bet.amount)
        if (productType === 3 || productType === 7) {
          if (amount > oldAmount) {
            const diff = round2(amount - oldAmount)
            if (balance < diff) {
              await conn.commit()
              return err(5, 'Not enough balance', player.username, balance, { BetAmount: 0 })
            }
            const newBalance = await this.changeBalance(conn, player, -diff)
            await conn.execute(
              `UPDATE bg_568win_wallet_txn SET amount = ?, raw_request = ?, updated_at = NOW(3) WHERE id = ?`,
              [amount, JSON.stringify(body), bet.id],
            )
            await conn.execute(
              `UPDATE bg_bet_order SET amount = ?, original_amount = ? WHERE aggregator_id = '568win' AND provider_txn_id = ? AND bet_type = 'bet'`,
              [amount, amount, transferKey(body)],
            )
            await this.addLedger(conn, player, 'bet', -diff, newBalance, transferCode, '568Win raise bet')
            await conn.commit()
            return ok(player.username, newBalance, { BetAmount: amount })
          }
          await conn.commit()
          return err(amount < oldAmount ? 7 : 5003, amount < oldAmount ? 'Invalid raise amount' : 'Bet With Same RefNo Exists', player.username, balance, { BetAmount: 0 })
        }
        await conn.commit()
        return err(5003, 'Bet With Same RefNo Exists', player.username, current, { BetAmount: 0 })
      }

      if (balance < amount) {
        await conn.commit()
        return err(5, 'Not enough balance', player.username, balance, { BetAmount: 0 })
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
         VALUES (?, '568win', ?, ?, ?, 'bet', ?, ?, ?, 1, 'pending')`,
        [player.userId, String(body.GameId ?? body.Gpid ?? ''), transferKey(body), text(body, 'GameRoundId') || transferCode, amount, player.currency, amount],
      )
      await allocateBetTurnoverInTransaction(conn, player.userId, Number(result.insertId), amount, String(body.GameId ?? body.Gpid ?? ''), player.currency)
      await this.addLedger(conn, player, 'bet', -amount, newBalance, transferCode, '568Win deduct')
      await conn.commit()
      return ok(player.username, newBalance, { BetAmount: amount })
    } catch (e) {
      await conn.rollback()
      this.app.log.error({ err: e }, '[568win] deduct failed')
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  async returnStake(req: FastifyRequest, body: CallbackBody) {
    const invalid = this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
      await conn.beginTransaction()
      await this.lockedBalance(conn, player)
      const bets = await this.findTxns(conn, body, true)
      if (bets.length === 0) {
        await conn.commit()
        return err(6, 'Bet not exists')
      }
      const bet = bets[0]
      const balance = await this.currentBalance(conn, player)
      if (bet.status !== 'running') {
        await conn.commit()
        return err(7, 'Invalid bet state for return stake', player.username, balance)
      }

      const currentStake = round2(num(body, 'CurrentStake'))
      const oldStake = round2(Number(bet.amount))
      if (currentStake > oldStake) {
        await conn.commit()
        return err(7, 'Invalid current stake', player.username, balance)
      }

      const refund = round2(oldStake - currentStake)
      const newBalance = refund > 0 ? await this.changeBalance(conn, player, refund) : balance
      if (refund > 0) {
        await conn.execute(
          `UPDATE bg_568win_wallet_txn SET amount = ?, raw_request = ?, updated_at = NOW(3) WHERE id = ?`,
          [currentStake, JSON.stringify(body), bet.id],
        )
        await conn.execute(
          `UPDATE bg_bet_order SET amount = ?, original_amount = ? WHERE aggregator_id = '568win' AND provider_txn_id = ? AND bet_type = 'bet'`,
          [currentStake, currentStake, transferKey(body)],
        )
        await this.addLedger(conn, player, 'adjust', refund, newBalance, text(body, 'TransferCode'), '568Win return stake')
      }
      await conn.commit()
      return ok(player.username, newBalance)
    } catch (e) {
      await conn.rollback()
      this.app.log.error({ err: e }, '[568win] return stake failed')
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  async settle(req: FastifyRequest, body: CallbackBody) {
    const invalid = this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
      await conn.beginTransaction()
      await this.lockedBalance(conn, player)
      const lookupBody = { ...body, __singleNonVoid: true }
      let bets = await this.findTxns(conn, lookupBody, true)
      if (bets.length === 0 && int(body, 'ProductType') === 9 && !text(body, 'TransactionId')) {
        const all = await this.findTxns(conn, body, true)
        if (all.some((b) => b.status === 'Void')) {
          const bal = await this.currentBalance(conn, player)
          await conn.commit()
          return err(2002, 'Bet Already Canceled', player.username, bal)
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
        return err(2002, 'Bet Already Canceled', player.username, balance)
      }
      if (bet.status === 'settled') {
        await conn.commit()
        return err(2001, 'Bet Already Settled', player.username, balance)
      }
      const winLoss = round2(num(body, 'WinLoss'))
      const newBalance = await this.changeBalance(conn, player, winLoss)
      await conn.execute(
        `UPDATE bg_568win_wallet_txn
         SET status = 'settled', win_loss = ?, transaction_id = COALESCE(transaction_id, ?), raw_request = ?, settled_at = NOW(3)
         WHERE id = ?`,
        [winLoss, text(body, 'TransactionId') || null, JSON.stringify(body), bet.id],
      )
      await conn.execute(
        `UPDATE bg_bet_order SET status = 'settled', settled_at = NOW(3)
         WHERE aggregator_id = '568win' AND provider_txn_id = ? AND bet_type = 'bet'`,
        [bet.transaction_id ? `${bet.transfer_code}:${bet.transaction_id}` : bet.transfer_code],
      )
      await conn.execute(
        `INSERT IGNORE INTO bg_bet_order
         (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status, settled_at)
         VALUES (?, '568win', ?, ?, ?, 'win', ?, ?, ?, 1, 'settled', NOW(3))`,
        [player.userId, text(body, 'GameCode') || bet.provider_id, `settle:${bet.id}`, bet.round_id ?? bet.transfer_code, winLoss, player.currency, winLoss],
      )
      await this.addLedger(conn, player, 'win', winLoss, newBalance, bet.transfer_code, '568Win settle')
      await conn.commit()
      return ok(player.username, newBalance)
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
    const invalid = this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
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
        bets = await this.findTxns(conn, body, true)
      } else {
        bets = await this.findTxns(conn, body, true)
      }
      if (bets.length === 0) {
        await conn.commit()
        return err(6, 'Bet not exists')
      }

      const balance = await this.currentBalance(conn, player)
      if (mode === 'cancel' && bets.every((b) => b.status === 'Void')) {
        await conn.commit()
        return err(2002, 'Bet Already Canceled', player.username, balance)
      }
      if (mode === 'rollback') {
        const settledOrVoid = bets.filter((b) => b.status === 'settled' || b.status === 'Void')
        if (settledOrVoid.length === 0) {
          await conn.commit()
          return err(bets.some((b) => b.status === 'running' && b.win_loss !== null) ? 2003 : 7, bets.some((b) => b.status === 'running' && b.win_loss !== null) ? 'Bet Already Rollback' : 'Invalid Bet State For Rollback', player.username, balance)
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
      await conn.execute(
        `INSERT IGNORE INTO bg_bet_order
         (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status, settled_at)
         VALUES (?, '568win', ?, ?, ?, ?, ?, ?, ?, 1, 'settled', NOW(3))`,
        [player.userId, String(body.GameId ?? body.Gpid ?? ''), `${mode}:${transferKey(body)}`, text(body, 'TransferCode'), mode === 'cancel' ? 'cancel' : 'refund', adjustment, player.currency, adjustment],
      )
      await this.addLedger(conn, player, adjustment >= 0 ? 'adjust' : 'bet', adjustment, newBalance, text(body, 'TransferCode'), `568Win ${mode}`)
      await conn.commit()
      if (mode === 'rollback') {
        reverseBetTurnover(this.db, player.userId, text(body, 'TransferCode')).catch((rollbackErr) => {
          this.app.log.error({ err: rollbackErr }, '[568win] reverse turnover failed')
        })
      }
      return ok(player.username, newBalance)
    } catch (e) {
      await conn.rollback()
      this.app.log.error({ err: e }, `[568win] ${mode} failed`)
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  async bonus(req: FastifyRequest, body: CallbackBody) {
    const invalid = this.validate(req, body)
    if (invalid) return err(invalid.code, invalid.message)
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return err(1, 'Member does not exist')

    const conn = await this.db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
      await conn.beginTransaction()
      const balance = await this.lockedBalance(conn, player)
      const existing = await this.findAllByTransfer(conn, text(body, 'TransferCode'), true)
      if (existing.length > 0) {
        await conn.commit()
        return err(5003, 'Bet With Same RefNo Exists', player.username, balance)
      }
      const amount = round2(num(body, 'Amount'))
      const newBalance = await this.changeBalance(conn, player, amount)
      await conn.execute(
        `INSERT INTO bg_568win_wallet_txn
         (user_id, external_username, currency, transfer_code, transaction_id, product_type, game_type, gpid, provider_id, round_id, txn_type, amount, status, raw_request, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bonus', ?, 'settled', ?, NOW(3))`,
        [
          player.userId, player.username, player.currency, text(body, 'TransferCode'), text(body, 'TransactionId') || null,
          int(body, 'ProductType'), int(body, 'GameType'), body.Gpid === undefined ? null : int(body, 'Gpid'),
          String(body.GameId ?? body.Gpid ?? ''), text(body, 'TransferCode'), amount, JSON.stringify(body),
        ],
      )
      await this.addLedger(conn, player, 'bonus', amount, newBalance, text(body, 'TransferCode'), '568Win bonus')
      await conn.commit()
      return ok(player.username, newBalance)
    } catch (e) {
      await conn.rollback()
      this.app.log.error({ err: e }, '[568win] bonus failed')
      return err(7, 'Internal error')
    } finally {
      conn.release()
    }
  }

  async getBetStatus(req: FastifyRequest, body: CallbackBody) {
    const invalid = this.validate(req, body)
    if (invalid) return { TransferCode: '', TransactionId: '', Status: '', WinLoss: 0, Stake: 0, ErrorCode: invalid.code, ErrorMessage: invalid.message }
    if (!text(body, 'Username')) return { TransferCode: '', TransactionId: '', Status: '', WinLoss: 0, Stake: 0, ErrorCode: 3, ErrorMessage: 'Username empty' }
    const player = await this.resolvePlayer(text(body, 'Username'))
    if (!player) return { TransferCode: '', TransactionId: '', Status: '', WinLoss: 0, Stake: 0, ErrorCode: 1, ErrorMessage: 'Member does not exist' }

    const conn = await this.db.getConnection()
    try {
      const bets = await this.findTxns(conn, body, false)
      if (bets.length === 0) return { TransferCode: text(body, 'TransferCode'), TransactionId: text(body, 'TransactionId'), Status: '', WinLoss: 0, Stake: 0, ErrorCode: 6, ErrorMessage: 'Bet not exists' }
      const bet = bets[0]
      const status = bet.status.toLowerCase()
      return {
        TransferCode: bet.transfer_code,
        TransactionId: bet.transaction_id ?? '',
        Status: status,
        WinLoss: status === 'settled' ? round2(Number(bet.win_loss ?? 0)) : 0,
        Stake: round2(Number(bet.amount)),
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
