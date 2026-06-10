import type { Pool, RowDataPacket } from 'mysql2/promise'

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000

export type TurnoverBreakdownItem = { currency: string; betCents: number }

/** 当前 PHT 日期 YYYY-MM-DD（与日结引擎一致） */
export function phtToday(): string {
  return new Date(Date.now() + PHT_OFFSET_MS).toISOString().slice(0, 10)
}

function phtDayUtcRange(date: string): [Date, Date] {
  const [y, m, d] = date.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, d) - PHT_OFFSET_MS)
  const end = new Date(Date.UTC(y, m - 1, d + 1) - PHT_OFFSET_MS)
  return [start, end]
}

function mergeBreakdownRows(
  map: Map<string, TurnoverBreakdownItem[]>,
  rows: RowDataPacket[],
): void {
  for (const b of rows) {
    const uid = String(b.user_id)
    const cur = String(b.currency_code)
    const cents = Number(b.bet_cents)
    if (!cents) continue
    if (!map.has(uid)) map.set(uid, [])
    const arr = map.get(uid)!
    const existing = arr.find((x) => x.currency === cur)
    if (existing) existing.betCents += cents
    else arr.push({ currency: cur, betCents: cents })
  }
}

/**
 * 团队树流水：历史日用 turnover_daily，当月今日用 bg_bet_order 实时合并。
 */
export async function fetchMonthTurnoverBreakdown(
  db: Pool,
  userIds: string[],
  month: string,
): Promise<Map<string, TurnoverBreakdownItem[]>> {
  const bkMap = new Map<string, TurnoverBreakdownItem[]>()
  if (userIds.length === 0) return bkMap

  const likeParam = `${month}%`
  const today = phtToday()
  const isCurrentMonth = today.slice(0, 7) === month
  const placeholders = userIds.map(() => '?').join(',')

  const [dailyRows] = await db.query<RowDataPacket[]>(
    isCurrentMonth
      ? `SELECT user_id, currency_code, SUM(bet_cents) AS bet_cents
         FROM bg_team_turnover_daily
         WHERE user_id IN (${placeholders}) AND date LIKE ? AND date < ?
         GROUP BY user_id, currency_code`
      : `SELECT user_id, currency_code, SUM(bet_cents) AS bet_cents
         FROM bg_team_turnover_daily
         WHERE user_id IN (${placeholders}) AND date LIKE ?
         GROUP BY user_id, currency_code`,
    isCurrentMonth ? [...userIds, likeParam, today] : [...userIds, likeParam],
  )
  mergeBreakdownRows(bkMap, dailyRows)

  if (isCurrentMonth) {
    const [start, end] = phtDayUtcRange(today)
    const [liveRows] = await db.query<RowDataPacket[]>(
      `SELECT bo.user_id, COALESCE(bo.currency_code, 'PHP') AS currency_code,
              ROUND(SUM(bo.amount) * 100) AS bet_cents
       FROM bg_bet_order bo
       JOIN bg_user u ON u.id = bo.user_id
       WHERE bo.user_id IN (${placeholders})
         AND bo.created_at >= ? AND bo.created_at < ?
         AND bo.created_at >= u.registered_at
         AND bo.bet_type = 'bet' AND bo.status = 'settled'
       GROUP BY bo.user_id, bo.currency_code`,
      [...userIds, start, end],
    )
    mergeBreakdownRows(bkMap, liveRows)
  }

  return bkMap
}

export function sumBreakdownCents(items: TurnoverBreakdownItem[]): number {
  return items.reduce((s, i) => s + i.betCents, 0)
}
