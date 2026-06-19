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
): Promise<{ betTotal: number; winTotal: number; txnCount: number }> {
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN bet_type = 'bet'    THEN amount ELSE 0 END) AS bet_total,
       SUM(CASE WHEN bet_type IN ('win','refund') THEN amount ELSE 0 END) AS win_total,
       COUNT(*) AS txn_count
     FROM bg_bet_order
     WHERE aggregator_id = 'slotegrator'
       AND DATE(created_at) = ?`,
    [date],
  )
  return {
    betTotal: Number(rows[0]?.bet_total ?? 0),
    winTotal: Number(rows[0]?.win_total ?? 0),
    txnCount: Number(rows[0]?.txn_count ?? 0),
  }
}

async function saveSettlementReport(
  env: Env,
  data: {
    date: string
    sgBet: number
    sgWin: number
    sgRoundCount: number
    localBet: number
    localWin: number
    discrepancyNote: string | null
    rawData: unknown
    reconciled: 0 | 1
  },
): Promise<void> {
  const db = getMysqlPool(env)
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
      data.date, env.SG_CURRENCY,
      data.sgBet.toFixed(4), data.sgWin.toFixed(4), (data.sgBet - data.sgWin).toFixed(4), data.sgRoundCount,
      data.localBet, data.localWin,
      data.discrepancyNote,
      JSON.stringify(data.rawData),
      data.reconciled,
    ],
  )
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// 核心：拉取 SG 日结算并与本地对账，结果写入 sg_settlement_report
export async function runDailyReconciliation(env: Env, date: string): Promise<void> {
  if (!env.SG_BASE_URL || !env.SG_MERCHANT_ID) {
    console.warn('[sg-settlement] SG not configured, skipping reconciliation')
    return
  }

  console.log(`[sg-settlement] reconciling ${date}...`)

  let sgItems: SgTxnItem[]
  try {
    sgItems = await fetchAllSgTransactions(env, date)
  } catch (err) {
    const local = await queryLocalTotals(env, date)
    const message = `SG 报告拉取失败: ${errMessage(err)}`
    await saveSettlementReport(env, {
      date,
      sgBet: 0,
      sgWin: 0,
      sgRoundCount: 0,
      localBet: local.betTotal,
      localWin: local.winTotal,
      discrepancyNote: message,
      rawData: { error: message },
      reconciled: 0,
    })
    console.error(`[sg-settlement] failed to fetch SG report for ${date}:`, err)
    throw err
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
  const discrepancyNotes: string[] = []

  if (sgItems.length !== local.txnCount) {
    discrepancyNotes.push(`SG txn count: ${sgItems.length}, local count: ${local.txnCount}`)
  }
  if (Math.abs(sgBet - local.betTotal) >= 0.0001) {
    discrepancyNotes.push(`SG bet: ${sgBet.toFixed(4)}, local bet: ${local.betTotal.toFixed(4)}`)
  }
  if (Math.abs(sgWin - local.winTotal) >= 0.0001) {
    discrepancyNotes.push(`SG win: ${sgWin.toFixed(4)}, local win: ${local.winTotal.toFixed(4)}`)
  }
  const discrepancyNote = discrepancyNotes.length > 0 ? discrepancyNotes.join('; ') : null

  if (discrepancyNote) console.warn(`[sg-settlement] discrepancy on ${date}: ${discrepancyNote}`)

  await saveSettlementReport(env, {
    date,
    sgBet,
    sgWin,
    sgRoundCount,
    localBet: local.betTotal,
    localWin: local.winTotal,
    discrepancyNote,
    rawData: { total: sgItems.length, sample: sgItems.slice(0, 3) },
    reconciled: discrepancyNote === null ? 1 : 0,
  })

  console.log(`[sg-settlement] ${date} done — SG bet=${sgBet} ${sgCurrency}, GGR=${sgGgr.toFixed(2)}, discrepancy=${discrepancyNote ?? 'none'}`)
}

// 返回昨日日期字符串 YYYY-MM-DD（UTC）
export function yesterday(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
