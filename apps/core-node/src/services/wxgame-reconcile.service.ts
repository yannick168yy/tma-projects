import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { WxgameClient, type WxgameHistoryRow } from '../clients/wxgame.client.js'
import { WXGAME_AGGREGATOR_ID } from './wxgame-player.service.js'

const PAGE_SIZE = 500          // 上游上限 1000，留余量
const MAX_PAGES = 40           // 单轮封顶 2 万条，避免异常时打满限流（60 次/分钟）
const PAGE_DELAY_MS = 1200     // 每页间隔，配合上面封顶不会触发 1020
const OVERLAP_SEC = 30 * 60    // 游标回退 30 分钟：晚到的回调下一轮还能被捞回来
const AMOUNT_EPSILON = 0.01    // 两位小数，差一分以内不算差异

interface Cursor { nextTimeUtc: number | null; nextId: number | null }

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function decodePageToken(token?: string): Cursor | null {
  if (!token) return null
  try {
    const o = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as Record<string, unknown>
    return { nextTimeUtc: Number(o.nextTimeAtUTC) || null, nextId: Number(o.nextID) || null }
  } catch {
    return null
  }
}

async function loadCursor(app: FastifyInstance): Promise<Cursor> {
  const [[row]] = await app.mysql.query<RowDataPacket[]>(
    `SELECT next_time_utc, next_id FROM bg_wxgame_recon_cursor WHERE id = 1`,
  )
  return { nextTimeUtc: row?.next_time_utc ? Number(row.next_time_utc) : null, nextId: row?.next_id ? Number(row.next_id) : null }
}

async function saveCursor(app: FastifyInstance, c: Cursor, scanned: number, error: string | null) {
  await app.mysql.query(
    `INSERT INTO bg_wxgame_recon_cursor (id, next_time_utc, next_id, last_run_at, last_scanned, last_error)
     VALUES (1, ?, ?, NOW(3), ?, ?)
     ON DUPLICATE KEY UPDATE next_time_utc = VALUES(next_time_utc), next_id = VALUES(next_id),
       last_run_at = VALUES(last_run_at), last_scanned = VALUES(last_scanned), last_error = VALUES(last_error)`,
    [c.nextTimeUtc, c.nextId, scanned, error],
  )
}

async function recordDiff(app: FastifyInstance, d: {
  roundId: string; transactionId?: string | null; playerId?: string | null; userId?: string | null
  diffType: 'missing_local' | 'amount_mismatch' | 'missing_upstream' | 'status_mismatch'
  upstreamBet?: number | null; upstreamWin?: number | null; upstreamStatus?: string | null
  localBet?: number | null; localWin?: number | null; detail?: unknown
}) {
  await app.mysql.query(
    `INSERT INTO bg_wxgame_recon_diff
       (round_id, transaction_id, player_id, user_id, diff_type,
        upstream_bet, upstream_win, upstream_status, local_bet, local_win, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       upstream_bet = VALUES(upstream_bet), upstream_win = VALUES(upstream_win),
       upstream_status = VALUES(upstream_status), local_bet = VALUES(local_bet),
       local_win = VALUES(local_win), detail = VALUES(detail),
       -- 已人工处理过的不因为重复扫到而复活；差异真的还在，下面的告警计数仍会算上
       resolved_at = resolved_at`,
    [d.roundId, d.transactionId ?? null, d.playerId ?? null, d.userId ?? null, d.diffType,
      d.upstreamBet ?? null, d.upstreamWin ?? null, d.upstreamStatus ?? null,
      d.localBet ?? null, d.localWin ?? null, d.detail ? JSON.stringify(d.detail) : null],
  )
}

/**
 * 比对一批上游记录。
 *
 * 上游一条 history 记录 ≈ 一局（带 bet/win 汇总与 status），我方 bg_bet_round 也是每局一行，
 * 所以按 roundId 对。CANCELED 的局我方是 bet + refund 两行、汇总后 win_amount 含退款额，
 * 与上游的 bet/win 口径对不上，单独放过。
 */
async function compareBatch(app: FastifyInstance, rows: WxgameHistoryRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const roundIds = rows.map((r) => r.roundId).filter(Boolean)
  if (roundIds.length === 0) return 0

  const [localRows] = await app.mysql.query<RowDataPacket[]>(
    `SELECT round_id, user_id, bet_amount, win_amount FROM bg_bet_round
     WHERE aggregator_id = ? AND round_id IN (?)`,
    [WXGAME_AGGREGATOR_ID, roundIds],
  )
  const local = new Map(localRows.map((r) => [String(r.round_id), r]))

  let diffs = 0
  for (const up of rows) {
    if (!up.roundId) continue
    const mine = local.get(up.roundId)

    if (!mine) {
      // 上游有、我方没有 = 掉单。这是对账最要抓的一类：玩家已经输赢完，我方账上没有。
      // INIT/BET 状态可能只是还没结算完，不算掉单。
      if (up.status === 'INIT' || up.status === 'BET') continue
      await recordDiff(app, {
        roundId: up.roundId, transactionId: up.transactionId, playerId: up.playerId,
        diffType: 'missing_local', upstreamBet: up.bet, upstreamWin: up.win,
        upstreamStatus: up.status, detail: up,
      })
      diffs++
      continue
    }

    if (up.status === 'CANCELED') continue

    const betGap = Math.abs(Number(mine.bet_amount) - Number(up.bet ?? 0))
    const winGap = Math.abs(Number(mine.win_amount) - Number(up.win ?? 0))
    if (betGap > AMOUNT_EPSILON || winGap > AMOUNT_EPSILON) {
      await recordDiff(app, {
        roundId: up.roundId, transactionId: up.transactionId, playerId: up.playerId,
        userId: String(mine.user_id), diffType: 'amount_mismatch',
        upstreamBet: up.bet, upstreamWin: up.win, upstreamStatus: up.status,
        localBet: Number(mine.bet_amount), localWin: Number(mine.win_amount), detail: up,
      })
      diffs++
    }
  }
  return diffs
}

export async function reconcileWxgame(app: FastifyInstance): Promise<{ scanned: number; diffs: number }> {
  const client = new WxgameClient()
  const start = await loadCursor(app)

  // 从上次位置回退一段重扫：上游记录的 status 会从 BET 变成 SETTLED，
  // 只往前扫会把「当时还没结算、后来结算了」的局永远留在未比对状态。
  let cursor: Cursor = {
    nextTimeUtc: start.nextTimeUtc ? start.nextTimeUtc - OVERLAP_SEC : null,
    nextId: null,
  }

  let scanned = 0
  let diffs = 0
  let error: string | null = null
  let latest: Cursor = start

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.getGameHistoryList({
        page: {
          pageSize: PAGE_SIZE,
          ...(cursor.nextTimeUtc ? { nextTimeAtUTC: cursor.nextTimeUtc } : {}),
          ...(cursor.nextId ? { nextID: cursor.nextId } : {}),
        },
      })
      if (res.code !== 0) {
        error = `upstream code ${res.code}: ${res.msg ?? ''}`
        app.log.error({ code: res.code, msg: res.msg, requestId: res.requestId }, '[wxgame-recon] upstream error')
        break
      }
      // 无数据时上游连 list 字段都不返回（实测），不能默认它是数组
      const list = res.data?.list ?? []
      scanned += list.length
      diffs += await compareBatch(app, list)

      const next = decodePageToken(res.data?.pageToken)
      if (next) latest = next
      // 上游即使没数据也回显一个 token，只能靠「本页不满」判断到底
      if (list.length < PAGE_SIZE) break
      if (!next) break
      cursor = next
      await sleep(PAGE_DELAY_MS)
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    app.log.error({ err: e }, '[wxgame-recon] failed')
  }

  await saveCursor(app, latest, scanned, error)
  if (diffs > 0) app.log.warn({ scanned, diffs }, '[wxgame-recon] 发现对账差异')
  else app.log.info({ scanned }, '[wxgame-recon] done')
  return { scanned, diffs }
}
