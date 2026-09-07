import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { createHash } from 'node:crypto'
import { env } from '../config/env.js'

export const WXGAME_AGGREGATOR_ID = 'wxgame'

export interface WxgamePlayer {
  userId: string
  playerId: string
  currency: string
}

// 上游明确要求 playerId「不要带特殊字符，只支持数字跟字母」，比 568win 的
// [A-Za-z0-9_]{6,40} 更严 —— 下划线也不行，所以不能复用 toWin568Username。
export function toWxgamePlayerId(userId: string): string {
  return userId.replace(/[^A-Za-z0-9]/g, '')
}

// 去掉下划线会让 BG_10025 与 BG10025 撞成同一个 playerId。撞了就追加 userId 的短哈希，
// 保证同一 userId 永远算出同一个候选序列（可重入，重试不会又生成一个新账号）。
function candidates(userId: string): string[] {
  const base = toWxgamePlayerId(userId)
  const hash = createHash('sha256').update(userId).digest('hex').slice(0, 6)
  return [base, `${base}${hash}`]
}

export async function resolveWxgamePlayer(app: FastifyInstance, playerId: string): Promise<WxgamePlayer | null> {
  if (!playerId) return null
  const [[row]] = await app.mysql.query<RowDataPacket[]>(
    `SELECT ap.user_id, ap.external_username, ap.currency, u.status
     FROM bg_aggregator_player ap
     JOIN bg_user u ON u.id = ap.user_id
     WHERE ap.aggregator_id = ? AND ap.external_username = ?
     LIMIT 1`,
    [WXGAME_AGGREGATOR_ID, playerId],
  )
  if (!row || row.status !== 'active') return null
  return {
    userId: String(row.user_id),
    playerId: String(row.external_username),
    currency: String(row.currency || env.WXGAME_DEFAULT_CURRENCY),
  }
}

export async function ensureWxgamePlayer(app: FastifyInstance, userId: string, currency: string): Promise<WxgamePlayer> {
  const [[mapped]] = await app.mysql.query<RowDataPacket[]>(
    `SELECT external_username, currency FROM bg_aggregator_player
     WHERE aggregator_id = ? AND user_id = ? LIMIT 1`,
    [WXGAME_AGGREGATOR_ID, userId],
  )
  if (mapped) return { userId, playerId: String(mapped.external_username), currency: String(mapped.currency || currency) }

  for (const playerId of candidates(userId)) {
    if (!playerId) continue
    const [[used]] = await app.mysql.query<RowDataPacket[]>(
      `SELECT user_id FROM bg_aggregator_player
       WHERE aggregator_id = ? AND external_username = ? LIMIT 1`,
      [WXGAME_AGGREGATOR_ID, playerId],
    )
    if (used && String(used.user_id) !== userId) continue
    await app.mysql.query(
      `INSERT INTO bg_aggregator_player (aggregator_id, user_id, external_username, currency)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE external_username = VALUES(external_username), currency = VALUES(currency)`,
      [WXGAME_AGGREGATOR_ID, userId, playerId, currency],
    )
    return { userId, playerId, currency }
  }
  throw new Error(`cannot allocate wxgame playerId for ${userId}`)
}
