import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { env } from '../config/env.js'
import { wxgameSign } from '../clients/wxgame.client.js'
import { addLedger, changeBalance, currentBalance, ensureWallet, isDupEntry, lockedBalance, refreshBetRound, round2 } from './wallet-ledger.js'
import { allocateBetTurnoverInTransaction } from './turnover.service.js'
import { consumeLaunchToken } from './wxgame-launch.service.js'
import { resolveWxgamePlayer, WXGAME_AGGREGATOR_ID, type WxgamePlayer } from './wxgame-player.service.js'

type CallbackBody = Record<string, unknown>

// 上游错误码表（文档 §3）。只列我方会返回的。
export const WX = {
  OK: 0,
  INTERNAL: 1001,
  BAD_SIGN: 1004,
  BAD_PARAMS: 1005,
  BAD_TOKEN: 1006,
  TOKEN_EXPIRED: 1007,
  NO_BALANCE: 1011,
  NO_PLAYER: 1012,
  BAD_CURRENCY: 1015,
  BAD_IP: 1019,
  DUP_TXN: 1018,
} as const

const NONCE_PREFIX = 'wxgame:nonce:'
const TIMESTAMP_WINDOW_SEC = 60
// Nonce 去重窗口要比时间戳窗口宽，否则窗口边界上的请求刚过期就能重放
const NONCE_TTL_SEC = TIMESTAMP_WINDOW_SEC * 2

// game_type → 洗码大类。上游只有 slot/table/fish/poker 四种（实测 288 款只出现前两种）。
const SORT_CATEGORY: Record<string, string> = {
  slot: 'slots', fish: 'fishing', table: 'table', poker: 'table',
}

function num(body: CallbackBody, key: string): number {
  const v = Number(body[key] ?? 0)
  return Number.isFinite(v) ? v : 0
}

function text(body: CallbackBody, key: string): string {
  const v = body[key]
  return v === null || v === undefined ? '' : String(v)
}

function ok<T>(data: T) {
  return { code: WX.OK, data, msg: 'success', requestId: randomUUID().replace(/-/g, '') }
}

function fail(code: number, msg: string) {
  return { code, data: null, msg, requestId: randomUUID().replace(/-/g, '') }
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

function header(req: FastifyRequest, key: string): string {
  const v = req.headers[key.toLowerCase()]
  return typeof v === 'string' ? v.trim() : ''
}

export class WxgameWalletService {
  constructor(private app: FastifyInstance) {}

  private get db() { return this.app.mysql }

  /**
   * 三层闸，缺一不可。
   *
   * 上游签名式子是 Hex(SHA256(AccessKeySecret + Nonce + Timestamp)) —— 不含 body、
   * 不含路径、不含方法。也就是说同一组 Nonce+Timestamp 算出的 Sign，在时间戳有效期内
   * 可以配任意请求体复用。只验签名等于没验，所以额外叠了 Nonce 去重和 IP 白名单；
   * 再加上 bg_bet_order 的 uk_provider_txn 幂等兜底，四层里破了三层钱也不会重复扣。
   */
  private async validate(req: FastifyRequest): Promise<{ code: number; msg: string } | null> {
    const strict = env.NODE_ENV === 'production'

    const allowed = env.WXGAME_ALLOWED_IPS.split(',').map((s) => s.trim()).filter(Boolean)
    if (allowed.length === 0) {
      if (strict) {
        this.app.log.error('WXGAME_ALLOWED_IPS not configured, rejecting callback')
        return { code: WX.BAD_IP, msg: 'Invalid IP' }
      }
    } else if (!allowed.includes(getClientIp(req))) {
      return { code: WX.BAD_IP, msg: 'Invalid IP' }
    }

    const secret = env.WXGAME_ACCESS_KEY_SECRET
    if (!secret) {
      if (strict) {
        this.app.log.error('WXGAME_ACCESS_KEY_SECRET not configured, rejecting callback')
        return { code: WX.BAD_SIGN, msg: 'Invalid hash code' }
      }
      return null
    }

    const nonce = header(req, 'Nonce')
    const timestamp = Number(header(req, 'Timestamp'))
    const sign = header(req, 'Sign')
    if (!nonce || !sign || !Number.isFinite(timestamp)) return { code: WX.BAD_PARAMS, msg: 'Invalid parameters' }

    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > TIMESTAMP_WINDOW_SEC) {
      return { code: WX.BAD_SIGN, msg: 'Invalid hash code' }
    }
    if (sign.toLowerCase() !== wxgameSign(secret, nonce, timestamp)) {
      return { code: WX.BAD_SIGN, msg: 'Invalid hash code' }
    }

    // SET NX 拿不到就是这个 Nonce 用过了 —— 签名不覆盖 body，不去重就能原样重放换个金额
    const redis = this.app.redis as unknown as Redis
    const fresh = await redis.set(NONCE_PREFIX + nonce, '1', 'EX', NONCE_TTL_SEC, 'NX')
    if (fresh !== 'OK') return { code: WX.BAD_SIGN, msg: 'Duplicated nonce' }

    return null
  }

  private async balanceOf(player: WxgamePlayer): Promise<number> {
    const conn = await this.db.getConnection()
    try {
      await ensureWallet(conn, player)
      return await currentBalance(conn, player)
    } finally {
      conn.release()
    }
  }

  /** 上游拿我方签发的一次性 token 换玩家信息，是整个起游戏流程的第二步 */
  async verify(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req)
    if (invalid) return fail(invalid.code, invalid.msg)

    const payload = await consumeLaunchToken(this.app, text(body, 'token'))
    if (!payload) return fail(WX.BAD_TOKEN, 'Invalid player token')

    // token 里记着签发时绑定的游戏。上游是否自行校验尚未答复，我方先自己挡住，
    // 否则玩家可以拿 A 游戏的 token 起 B 游戏。
    const gameId = text(body, 'gameId')
    if (gameId && gameId !== payload.gameId) {
      this.app.log.warn({ token: payload.gameId, got: gameId }, '[wxgame] verify gameId mismatch')
      return fail(WX.BAD_TOKEN, 'Invalid player token')
    }

    const player = await resolveWxgamePlayer(this.app, payload.playerId)
    if (!player) return fail(WX.NO_PLAYER, 'Player not found')

    return ok({
      playerId: player.playerId,
      balance: await this.balanceOf(player),
      currency: player.currency,
    })
  }


  private async gameSortCategory(gameBrand: string, gameId: string): Promise<string | null> {
    const [[row]] = await this.db.query<RowDataPacket[]>(
      `SELECT game_type FROM bg_wxgame_game WHERE game_brand = ? AND game_id = ? LIMIT 1`,
      [gameBrand, gameId],
    )
    return row ? SORT_CATEGORY[String(row.game_type)] ?? null : null
  }

  /**
   * 三个记账动作共用的骨架。
   *
   * 幂等只靠一处：bg_bet_order 的 uk_provider_txn(aggregator_id, provider_txn_id)。
   * transactionId 上游保证全局唯一（bet/win/refund 各自一个），撞键即重复回调，
   * 返 1018 + 当前余额。不做「先查再插」，那中间有并发窗口。
   *
   * 注单直接落 status='settled'：无缝钱包下钱在回调返回时就已经动了，没有中间态。
   * 若沿用 568win 的 pending→settled，遇上不支持 win=0 回调的厂商（如 yono），
   * 那些 bet 会永远停在 pending，提现风控的盈亏统计只看 settled，等于看不见这些输赢。
   */
  private async apply(
    req: FastifyRequest,
    body: CallbackBody,
    opts: { betType: 'bet' | 'win' | 'refund'; amountKey: 'bet' | 'win'; sign: 1 | -1; ledgerType: string; description: string },
  ) {
    const invalid = await this.validate(req)
    if (invalid) return fail(invalid.code, invalid.msg)

    const transactionId = text(body, 'transactionId')
    const roundId = text(body, 'roundId')
    if (!transactionId || !roundId) return fail(WX.BAD_PARAMS, 'Invalid parameters')

    const player = await resolveWxgamePlayer(this.app, text(body, 'playerId'))
    if (!player) return fail(WX.NO_PLAYER, 'Player not found')

    // currency 选填，「以开户币种为准」。传了就必须与我方钱包一致，否则宁可拒绝也不猜换算。
    const declared = text(body, 'currency')
    if (declared && declared.toUpperCase() !== player.currency.toUpperCase()) {
      return fail(WX.BAD_CURRENCY, 'Invalid currency code')
    }

    const amount = round2(Math.abs(num(body, opts.amountKey)))
    const gameBrand = text(body, 'gameBrand').toLowerCase()
    const gameId = text(body, 'gameId')
    const delta = amount * opts.sign

    const conn = await this.db.getConnection()
    try {
      await conn.beginTransaction()
      const balance = await lockedBalance(conn, player)

      // 查重必须排在余额检查前。否则重复的下注回调在钱已扣掉、余额不够再扣一次时，
      // 会返回 1011「余额不足」而不是 1018「重复交易」——上游会当成玩家没钱，
      // 可能重试或把注单标失败，两边账就对不上。
      // 这里的「先查再插」有并发窗口，但兜底仍是下面 INSERT 的 uk_provider_txn，
      // 这条 SELECT 只为把错误码判对。
      const [[dup]] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM bg_bet_order WHERE aggregator_id = ? AND provider_txn_id = ? LIMIT 1`,
        [WXGAME_AGGREGATOR_ID, transactionId],
      )
      if (dup) {
        await conn.commit()
        return { ...fail(WX.DUP_TXN, 'Transaction already exists'), data: { balance, currency: player.currency } }
      }

      if (opts.sign < 0 && balance < amount) {
        await conn.commit()
        return fail(WX.NO_BALANCE, 'Insufficient balance')
      }

      const [order] = await conn.execute<ResultSetHeader>(
        `INSERT INTO bg_bet_order
           (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount,
            currency_code, original_amount, exchange_rate, status, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'settled', NOW(3))`,
        [player.userId, WXGAME_AGGREGATOR_ID, `${gameBrand}:${gameId}`, transactionId, roundId,
          opts.betType, amount, player.currency, amount],
      )

      await conn.execute(
        `INSERT INTO bg_wxgame_wallet_txn
           (user_id, player_id, currency, transaction_id, round_id, pre_round_id, bet_transaction_id,
            game_brand, game_id, txn_type, amount, raw_request)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [player.userId, player.playerId, player.currency, transactionId, roundId,
          text(body, 'preRoundId') || null, text(body, 'betTransactionId') || null,
          gameBrand, gameId, opts.betType, amount, JSON.stringify(body)],
      )

      const newBalance = await changeBalance(conn, player, delta)

      if (opts.betType === 'bet') {
        await allocateBetTurnoverInTransaction(conn, player.userId, Number(order.insertId), amount,
          { gpid: null, gameId: null, sortCategory: await this.gameSortCategory(gameBrand, gameId) },
          player.currency)
      }

      await addLedger(conn, player, opts.ledgerType, delta, newBalance, transactionId, opts.description)
      await refreshBetRound(conn, player.userId, roundId)
      await conn.commit()
      return ok({ balance: newBalance, currency: player.currency })
    } catch (e) {
      await conn.rollback()
      if (isDupEntry(e)) {
        const current = await this.balanceOf(player).catch(() => 0)
        return { ...fail(WX.DUP_TXN, 'Transaction already exists'), data: { balance: current, currency: player.currency } }
      }
      this.app.log.error({ err: e, transactionId }, `[wxgame] ${opts.betType} failed`)
      return fail(WX.INTERNAL, 'Internal server error')
    } finally {
      conn.release()
    }
  }

  bet(req: FastifyRequest, body: CallbackBody) {
    return this.apply(req, body, { betType: 'bet', amountKey: 'bet', sign: -1, ledgerType: 'bet', description: 'WXGame bet' })
  }

  /**
   * 派奖。**不要求存在对应的 /bet 行**：捕鱼按 3 秒批次结算，净值为正时上游直接发 /win，
   * 这一局可能根本没有前置 /bet（官方「特殊逻辑说明」明写「不能依赖 /bet 的前置回调」）。
   * 要求先有 bet 会把捕鱼的第一笔派奖直接拒掉。
   *
   * PG 等厂商还存在 1 bet 多 win，同一 roundId 会有多条 win —— bg_bet_round 是 SUM
   * 聚合，天然支持；isEnd 只标记本局是否还有后续，不参与记账。
   */
  win(req: FastifyRequest, body: CallbackBody) {
    return this.apply(req, body, { betType: 'win', amountKey: 'win', sign: 1, ledgerType: 'win', description: 'WXGame win' })
  }

  async refund(req: FastifyRequest, body: CallbackBody) {
    const res = await this.apply(req, body, { betType: 'refund', amountKey: 'bet', sign: 1, ledgerType: 'refund', description: 'WXGame refund' })
    // 上游要求 refund 的 data 除余额外还带处理状态
    if (res.code === WX.OK && res.data) return { ...res, data: { ...res.data, status: 'CANCELED' } }
    return res
  }

  async balance(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req)
    if (invalid) return fail(invalid.code, invalid.msg)

    const player = await resolveWxgamePlayer(this.app, text(body, 'playerId'))
    if (!player) return fail(WX.NO_PLAYER, 'Player not found')

    return ok({ balance: await this.balanceOf(player), currency: player.currency })
  }
}
