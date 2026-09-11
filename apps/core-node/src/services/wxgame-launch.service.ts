import type { FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { env } from '../config/env.js'

// 起游戏令牌：与 568win 不同，WXGame 的 token 由**我方**生成，上游拿它回调 /verify
// 换玩家信息（文档：「只是一个临时令牌，由商户自己定义生成」）。所以格式我方说了算，
// 用随机 UUID，不塞任何可推断信息。
const TOKEN_PREFIX = 'wxgame:launch:'

export interface LaunchTokenPayload {
  userId: string
  playerId: string
  currency: string
  gameBrand: string
  gameId: string
}

export async function issueLaunchToken(app: FastifyInstance, payload: LaunchTokenPayload): Promise<string> {
  const token = randomUUID().replace(/-/g, '')
  const redis = app.redis as unknown as Redis
  await redis.set(TOKEN_PREFIX + token, JSON.stringify(payload), 'EX', env.WXGAME_LAUNCH_TOKEN_TTL_SEC)
  return token
}

// 读后即删：一个 token 只能换一次玩家信息，重放会拿到 null 并被 /verify 判成 1006。
// 用 GETDEL 而不是 get + del，两步之间的并发会让同一 token 被兑换两次。
export async function consumeLaunchToken(app: FastifyInstance, token: string): Promise<LaunchTokenPayload | null> {
  if (!token) return null
  const redis = app.redis as unknown as Redis
  const raw = await redis.getdel(TOKEN_PREFIX + token)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LaunchTokenPayload
  } catch {
    return null
  }
}
