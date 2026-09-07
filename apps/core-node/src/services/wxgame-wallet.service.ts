import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { env } from '../config/env.js'
import { wxgameSign } from '../clients/wxgame.client.js'
import { currentBalance, ensureWallet } from './wallet-ledger.js'
import { consumeLaunchToken } from './wxgame-launch.service.js'
import { resolveWxgamePlayer, type WxgamePlayer } from './wxgame-player.service.js'

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

  async balance(req: FastifyRequest, body: CallbackBody) {
    const invalid = await this.validate(req)
    if (invalid) return fail(invalid.code, invalid.msg)

    const player = await resolveWxgamePlayer(this.app, text(body, 'playerId'))
    if (!player) return fail(WX.NO_PLAYER, 'Player not found')

    return ok({ balance: await this.balanceOf(player), currency: player.currency })
  }
}
