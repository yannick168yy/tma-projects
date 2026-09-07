import { createHash, randomUUID } from 'node:crypto'
import { env } from '../config/env.js'

export interface WxgameResponse<T = unknown> {
  code: number
  data?: T
  msg?: string
  requestId?: string
}

export interface WxgameGame {
  gameId: string
  gameName: string
  gameFullName: string
  gameType: string
  gameBrand: string
}

export interface WxgamePlayerRtp {
  playerId: string
  rtp: string
}

// 上游签名：Sign = Hex(SHA256(AccessKeySecret + Nonce + Timestamp))。
// 注意这个式子不含 body、不含路径、不含方法 —— 同一组 Nonce+Timestamp 算出的 Sign
// 在 60 秒内可以配任意请求体复用。我方作为接收方时不能只验 Sign，还要叠 Nonce 去重
// 与 IP 白名单，见 wxgame-wallet.service 的 validate()。
export function wxgameSign(secret: string, nonce: string, timestamp: number): string {
  return createHash('sha256').update(`${secret}${nonce}${timestamp}`).digest('hex')
}

export class WxgameClient {
  constructor(
    private accessKeyId = env.WXGAME_ACCESS_KEY_ID,
    private accessKeySecret = env.WXGAME_ACCESS_KEY_SECRET,
    private baseUrl = env.WXGAME_BASE_URL,
  ) {}

  private async post<T>(path: string, payload: Record<string, unknown>): Promise<WxgameResponse<T>> {
    const nonce = randomUUID().replace(/-/g, '')
    const timestamp = Math.floor(Date.now() / 1000)
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        AccessKeyId: this.accessKeyId,
        Sign: wxgameSign(this.accessKeySecret, nonce, timestamp),
        Nonce: nonce,
        Timestamp: String(timestamp),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    return await res.json() as WxgameResponse<T>
  }

  // token 是我方签发的一次性令牌，上游拿它回调我方 /verify 换玩家信息
  getGameUrl(input: { token: string; gameId: string; gameBrand: string; language: string }) {
    return this.post<string>('/v1/api/get_game_url', input)
  }

  getGameList(input: { gameBrand?: string; gameType?: string } = {}) {
    return this.post<{ gameList: WxgameGame[] }>('/v1/api/get_game_list', input)
  }

  // 只返回设置成功的 playerIds，调用方必须与入参比对差集，失败的要重试或告警
  setPlayerRtp(input: { playerIds: string[]; rtp: string }) {
    return this.post<{ playerIds: string[] }>('/v1/api/set_player_rtp', input)
  }

  getPlayerRtp(input: { playerIds: string[] }) {
    return this.post<{ playerRtps: WxgamePlayerRtp[] }>('/v1/api/get_player_rtp', input)
  }
}
