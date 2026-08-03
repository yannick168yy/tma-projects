import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import type { RowDataPacket } from 'mysql2/promise'

interface SseClient {
  write: (data: string) => void
}

const clients = new Set<SseClient>()

export function addSseBadgeClient(client: SseClient): void {
  clients.add(client)
}

export function removeSseBadgeClient(client: SseClient): void {
  clients.delete(client)
}

// 在线管理员数 = 当前 SSE 连接数,客服值班判断用
export function getSseBadgeClientCount(): number {
  return clients.size
}

async function fetchCounts(env: Env): Promise<{ manualWithdrawals: number; pendingCs: number; rejectedKyc: number }> {
  if (!isMysqlEnabled(env)) return { manualWithdrawals: 0, pendingCs: 0, rejectedKyc: 0 }
  const db = getMysqlPool(env)
  const [[wRow], [csRow], [kycRow]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT (
         SELECT COUNT(*) FROM bg_withdraw_order WHERE status = 'pending' AND review_verdict = 'manual' AND badge_ignored = 0
       ) + (
         SELECT COUNT(*) FROM bg_team_withdrawal WHERE status = 'pending' AND review_verdict = 'manual'
       ) AS cnt`,
    ),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM cs_conversation WHERE status IN ('human_taken','escalated')`,
    ),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM bg_kyc
       WHERE (status = 'rejected' AND badge_ignored = 0)
          OR (status = 'pending' AND doc_submitted_at IS NOT NULL AND doc_verified = 0)`,
    ),
  ])
  return {
    manualWithdrawals: Number(wRow[0]?.cnt ?? 0),
    pendingCs: Number(csRow[0]?.cnt ?? 0),
    rejectedKyc: Number(kycRow[0]?.cnt ?? 0),
  }
}

export async function broadcastBadges(env: Env): Promise<void> {
  if (clients.size === 0) return
  try {
    const badges = await fetchCounts(env)
    const msg = JSON.stringify(badges)
    for (const client of clients) {
      try { client.write(msg) } catch { clients.delete(client) }
    }
  } catch { /* 广播失败静默忽略 */ }
}

export { fetchCounts as fetchBadgeCounts }
