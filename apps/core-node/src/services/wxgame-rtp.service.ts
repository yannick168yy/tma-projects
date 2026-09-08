import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { WxgameClient } from '../clients/wxgame.client.js'
import { WXGAME_AGGREGATOR_ID } from './wxgame-player.service.js'

// 上游档位。常规户只开 50-97，高爆户才有 100/150/500。我方开户类型是「常规」，
// 所以 ALLOWED 只放 50-97 —— 传 100 以上上游会返 1021，与其让运营在后台点了才报错，
// 不如在这里就挡掉并说清楚原因。转高爆户后把注释掉的三档放开即可。
export const WXGAME_RTP_TIERS = ['50', '65', '75', '85', '90', '95', '97'] as const
export const WXGAME_RTP_TIERS_HIGH = ['100', '150', '500'] as const

export type WxgameRtpTier = (typeof WXGAME_RTP_TIERS)[number]

export function isValidRtpTier(v: unknown): v is WxgameRtpTier {
  return typeof v === 'string' && (WXGAME_RTP_TIERS as readonly string[]).includes(v)
}

// 上游单次最多 1000 个 playerId
const BATCH = 1000

async function playerIdsOf(app: FastifyInstance, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const [rows] = await app.mysql.query<RowDataPacket[]>(
    `SELECT user_id, external_username FROM bg_aggregator_player
     WHERE aggregator_id = ? AND user_id IN (?)`,
    [WXGAME_AGGREGATOR_ID, userIds],
  )
  return new Map(rows.map((r) => [String(r.user_id), String(r.external_username)]))
}

export interface RtpApplyResult {
  applied: string[]
  /** 上游没确认成功的（未开号、或上游拒绝）。这些行 synced_at 留 NULL 等重试 */
  failed: string[]
}

/**
 * 设置点控档位。
 *
 * 上游只返回**设置成功**的 playerIds，所以必须与入参比对差集 —— 失败的那些若不记下来，
 * 后台会显示"已生效"而实际没生效，运营按错误的前提做决策。
 * 未在 WXGame 开过号的玩家上游设不了（文档：只能设置已存在的用户），这类先落库、
 * synced_at 留 NULL，等玩家首次进游戏时由 /verify 响应带 rtp 一并生效。
 */
export async function setPlayerRtp(
  app: FastifyInstance,
  userIds: string[],
  rtp: WxgameRtpTier,
  operatorId: string,
  reason: string | null,
): Promise<RtpApplyResult> {
  const mapping = await playerIdsOf(app, userIds)

  const applied: string[] = []
  const targets = [...mapping.entries()]
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    const res = await new WxgameClient().setPlayerRtp({ playerIds: chunk.map(([, pid]) => pid), rtp })
    if (res.code !== 0) {
      app.log.error({ code: res.code, msg: res.msg, requestId: res.requestId }, '[wxgame-rtp] set failed')
      continue
    }
    const okIds = new Set(res.data?.playerIds ?? [])
    for (const [userId, pid] of chunk) if (okIds.has(pid)) applied.push(userId)
  }

  // 全部入库（含未确认的），后台要能看到"想设成什么"，同步状态由 synced_at 区分
  const appliedSet = new Set(applied)
  for (const userId of userIds) {
    await app.mysql.query(
      `INSERT INTO bg_wxgame_player_rtp (user_id, rtp, operator_id, reason, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rtp = VALUES(rtp), operator_id = VALUES(operator_id),
         reason = VALUES(reason), synced_at = VALUES(synced_at)`,
      [userId, rtp, operatorId, reason, appliedSet.has(userId) ? new Date() : null],
    )
  }

  return { applied, failed: userIds.filter((u) => !appliedSet.has(u)) }
}

/** 清除点控，恢复默认 RTP（开户默认 95） */
export async function unsetPlayerRtp(app: FastifyInstance, userIds: string[]): Promise<RtpApplyResult> {
  const mapping = await playerIdsOf(app, userIds)
  const applied: string[] = []
  const targets = [...mapping.entries()]
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    const res = await new WxgameClient().unsetPlayerRtp({ playerIds: chunk.map(([, pid]) => pid) })
    if (res.code !== 0) {
      app.log.error({ code: res.code, msg: res.msg }, '[wxgame-rtp] unset failed')
      continue
    }
    const okIds = new Set(res.data?.playerIds ?? [])
    for (const [userId, pid] of chunk) if (okIds.has(pid)) applied.push(userId)
  }
  if (applied.length > 0) {
    await app.mysql.query(`DELETE FROM bg_wxgame_player_rtp WHERE user_id IN (?)`, [applied])
  }
  return { applied, failed: userIds.filter((u) => !applied.includes(u)) }
}

/** 查上游真实生效值，用于后台核对本地记录是否与上游一致 */
export async function getPlayerRtp(app: FastifyInstance, userIds: string[]) {
  const mapping = await playerIdsOf(app, userIds)
  if (mapping.size === 0) return []
  const res = await new WxgameClient().getPlayerRtp({ playerIds: [...mapping.values()] })
  if (res.code !== 0) throw new Error(res.msg || 'get_player_rtp failed')
  const byPlayerId = new Map((res.data?.playerRtps ?? []).map((p) => [p.playerId, p.rtp]))
  return [...mapping.entries()].map(([userId, pid]) => ({
    userId, playerId: pid, upstreamRtp: byPlayerId.get(pid) ?? null,
  }))
}
