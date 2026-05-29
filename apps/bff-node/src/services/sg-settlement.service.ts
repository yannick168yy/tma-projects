import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { sgAuthHeaders } from './slotegrator.service.js'

interface SgTxnItem {
  player_id: string
  game_uuid: string
  round_id: string
  transaction_id: string
  type: 'bet' | 'win' | 'refund' | 'rollback'
  amount: string    // 原币金额，字符串
  currency: string
  created_at: string
}

interface SgReportPage {
  items: SgTxnItem[]
  _meta: {
    totalCount: number
    pageCount: number
    currentPage: number
    perPage: number
  }
}

// SG 报告 API 和游戏 API 使用相同的签名机制
async function fetchSgReport(env: Env, dateFrom: string, dateTo: string, page = 1): Promise<SgReportPage> {
  const params: Record<string, string | number> = {
    date_from: dateFrom,
    date_to: dateTo,
    page,
    'per-page': 100,
  }
  const headers = sgAuthHeaders(params as Record<string, string | number>, env)
  const body = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  )
  // 注意：SG 报告接口路径需根据实际文档确认，通常为 /report/transactions 或 /report
  const res = await fetch(`${env.SG_BASE_URL}/report/transactions`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`SG report API ${res.status}: ${await res.text()}`)
  return res.json() as Promise<SgReportPage>
}

// 拉取指定日期的全部 SG 交易记录（分页）
async function fetchAllSgTransactions(env: Env, date: string): Promise<SgTxnItem[]> {
  const all: SgTxnItem[] = []
  let page = 1
  let pageCount = 1
  do {
    const res = await fetchSgReport(env, `${date} 00:00:00`, `${date} 23:59:59`, page)
    all.push(...res.items)
    pageCount = res._meta.pageCount
    page++
  } while (page <= pageCount)
  return all
}

// 从本地 bg_bet_order 汇总指定日期的投注/派彩
async function queryLocalTotals(
  env: Env,
  date: string,
): Promise<{ betTotal: number; winTotal: number }> {
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN bet_type = 'bet'    THEN amount ELSE 0 END) AS bet_total,
       SUM(CASE WHEN bet_type IN ('win','refund') THEN amount ELSE 0 END) AS win_total
     FROM bg_bet_order
     WHERE aggregator_id = 'slotegrator'
       AND DATE(created_at) = ?`,
    [date],
  )
  return {
    betTotal: Number(rows[0]?.bet_total ?? 0),
    winTotal: Number(rows[0]?.win_total ?? 0),
  }
}

// 核心：拉取 SG 日结算并与本地对账，结果写入 sg_settlement_report
export async function runDailyReconciliation(env: Env, date: string): Promise<void> {
  if (!env.SG_BASE_URL || !env.SG_MERCHANT_ID) {
    console.warn('[sg-settlement] SG not configured, skipping reconciliation')
    return
  }

  const db = getMysqlPool(env)
  console.log(`[sg-settlement] reconciling ${date}...`)

  let sgItems: SgTxnItem[]
  try {
    sgItems = await fetchAllSgTransactions(env, date)
  } catch (err) {
    console.error(`[sg-settlement] failed to fetch SG report for ${date}:`, err)
    return
  }

  // SG 汇总（原币）
  const sgCurrency = env.SG_CURRENCY
  let sgBet = 0, sgWin = 0
  for (const item of sgItems) {
    const amt = parseFloat(item.amount ?? '0')
    if (item.type === 'bet')                 sgBet += amt
    if (item.type === 'win' || item.type === 'refund') sgWin += amt
  }
  const sgGgr = sgBet - sgWin

  // 本地汇总（PHP 元）
  const local = await queryLocalTotals(env, date)

  const sgRoundCount = new Set(sgItems.map((i) => i.round_id)).size
  let discrepancyNote: string | null = null

  if (sgItems.length === 0 && local.betTotal === 0) {
    discrepancyNote = null // 当日无数据，一致
  } else if (Math.abs(sgItems.length - (local.betTotal > 0 ? sgItems.length : 0)) > 0) {
    // 粗略检查：SG 事务数 vs 本地记录数
    const localTxnCount = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM bg_bet_order
       WHERE aggregator_id = 'slotegrator' AND DATE(created_at) = ?`, [date],
    ).then(([r]) => Number(r[0]?.cnt ?? 0))

    if (Math.abs(sgItems.length - localTxnCount) > 0) {
      discrepancyNote = `SG txn count: ${sgItems.length}, local count: ${localTxnCount}`
      console.warn(`[sg-settlement] discrepancy on ${date}: ${discrepancyNote}`)
    }
  }

  // UPSERT 结果
  await db.execute(
    `INSERT INTO sg_settlement_report
       (report_date, currency, sg_bet_amount, sg_win_amount, sg_ggr, sg_round_count,
        local_bet, local_win, discrepancy_note, raw_data, fetched_at, reconciled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?)
     ON DUPLICATE KEY UPDATE
       sg_bet_amount=VALUES(sg_bet_amount), sg_win_amount=VALUES(sg_win_amount),
       sg_ggr=VALUES(sg_ggr), sg_round_count=VALUES(sg_round_count),
       local_bet=VALUES(local_bet), local_win=VALUES(local_win),
       discrepancy_note=VALUES(discrepancy_note), raw_data=VALUES(raw_data),
       fetched_at=VALUES(fetched_at), reconciled=VALUES(reconciled)`,
    [
      date, sgCurrency,
      sgBet.toFixed(4), sgWin.toFixed(4), sgGgr.toFixed(4), sgRoundCount,
      local.betTotal, local.winTotal,
      discrepancyNote,
      JSON.stringify({ total: sgItems.length, sample: sgItems.slice(0, 3) }),
      discrepancyNote === null ? 1 : 0,
    ],
  )

  console.log(`[sg-settlement] ${date} done — SG bet=${sgBet} ${sgCurrency}, GGR=${sgGgr.toFixed(2)}, discrepancy=${discrepancyNote ?? 'none'}`)
}

// 返回昨日日期字符串 YYYY-MM-DD（UTC）
export function yesterday(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
