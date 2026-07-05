import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'

// Google 免费额度 1500 次/天（太平洋时间刷新），上限 1200 留足缓冲
const DAILY_CAP = Number(process.env.GEMINI_SEARCH_DAILY_CAP ?? 1200)

export function ptToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// 原子扣减：成功返回 true，当日额度耗尽返回 false
export async function tryConsumeGeminiSearchQuota(env: Env): Promise<boolean> {
  const db = getMysqlPool(env)
  const day = ptToday()
  await db.execute(`INSERT IGNORE INTO bg_gemini_search_quota (quota_date, used) VALUES (?, 0)`, [day])
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_gemini_search_quota SET used = used + 1 WHERE quota_date = ? AND used < ?`,
    [day, DAILY_CAP],
  )
  return res.affectedRows > 0
}

// Google 拒绝（429/5xx）的请求未实际执行，退回额度
export async function refundGeminiSearchQuota(env: Env): Promise<void> {
  const db = getMysqlPool(env)
  await db.execute(
    `UPDATE bg_gemini_search_quota SET used = GREATEST(used - 1, 0) WHERE quota_date = ?`,
    [ptToday()],
  ).catch(() => { /* 退额度失败不影响主流程 */ })
}

export async function geminiSearchQuotaUsed(env: Env): Promise<{ used: number; cap: number }> {
  const db = getMysqlPool(env)
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT used FROM bg_gemini_search_quota WHERE quota_date = ?`,
    [ptToday()],
  )
  return { used: Number(row?.used ?? 0), cap: DAILY_CAP }
}
