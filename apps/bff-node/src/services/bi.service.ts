import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { getRate } from './exchange-rate.service.js'

// BI 驾驶舱查询服务（只读）。
// 实时卡片：OLTP 窄时间窗查询（≤24h，走 created_at 索引），口径=今日累计 vs 昨日同时刻 vs 上周同日同时刻
// 趋势：只读 bi_daily_* 聚合表，多币种按当前汇率折算 PHP

const DAY_MS = 24 * 60 * 60 * 1000
const BONUS_LEDGER_TYPES = "'bonus','red_packet','rebate','vip_bonus','task_bonus'"

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/** 马尼拉今天 0 点的 UTC 毫秒 */
function manilaDayStartMs(offsetDays = 0): number {
  const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  return Date.parse(`${date}T00:00:00+08:00`) + offsetDays * DAY_MS
}

async function phpRates(redis: Redis, env: Env, currencies: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (const c of currencies) {
    if (map.has(c)) continue
    try {
      const r = await getRate(redis, c, 'PHP', env)
      map.set(c, r.rate)
    } catch {
      map.set(c, c === 'USD' ? 56 : 1) // 汇率不可得时的保守兜底，仅影响展示
    }
  }
  return map
}

export interface BiWindowStats {
  depositAmount: number
  depositCount: number
  withdrawAmount: number
  betAmount: number
  ggr: number
  bonusCost: number
  ngr: number
  dau: number
  newUsers: number
  firstDepUsers: number
}

async function windowStats(env: Env, redis: Redis, startMs: number, endMs: number): Promise<BiWindowStats> {
  const db = pool(env)
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)

  const [moneyRows] = await db.query<RowDataPacket[]>(
    `SELECT 'dep' src, currency, COUNT(*) cnt, COALESCE(SUM(amount),0) amt, 0 extra
       FROM bg_deposit_order WHERE status='paid' AND created_at>=? AND created_at<? GROUP BY currency
     UNION ALL
     SELECT 'wd', currency, COUNT(*), COALESCE(SUM(amount),0), 0
       FROM bg_withdraw_order WHERE status IN ('completed','processing') AND created_at>=? AND created_at<? GROUP BY currency
     UNION ALL
     SELECT 'bet', currency, COUNT(*), COALESCE(SUM(amount),0),
            COALESCE(SUM(CASE WHEN status='settled' THEN win_loss ELSE 0 END),0)
       FROM bg_568win_wallet_txn WHERE txn_type='bet' AND voided_at IS NULL AND created_at>=? AND created_at<? GROUP BY currency
     UNION ALL
     SELECT 'bonus', currency, 0, COALESCE(SUM(amount),0), 0
       FROM bg_wallet_ledger WHERE type IN (${BONUS_LEDGER_TYPES}) AND amount>0 AND created_at>=? AND created_at<? GROUP BY currency`,
    [start, end, start, end, start, end, start, end],
  )

  const rates = await phpRates(redis, env, moneyRows.map((r) => String(r.currency)))
  const toPhp = (cur: string, v: number) => v * (rates.get(cur) ?? 1)

  const s: BiWindowStats = {
    depositAmount: 0, depositCount: 0, withdrawAmount: 0,
    betAmount: 0, ggr: 0, bonusCost: 0, ngr: 0,
    dau: 0, newUsers: 0, firstDepUsers: 0,
  }
  for (const r of moneyRows) {
    const cur = String(r.currency)
    const amt = toPhp(cur, Number(r.amt))
    if (r.src === 'dep') { s.depositAmount += amt; s.depositCount += Number(r.cnt) }
    else if (r.src === 'wd') s.withdrawAmount += amt
    else if (r.src === 'bet') { s.betAmount += amt; s.ggr += amt - toPhp(cur, Number(r.extra)) }
    else if (r.src === 'bonus') s.bonusCost += amt
  }
  s.ngr = s.ggr - s.bonusCost

  const [[users]] = await db.query<RowDataPacket[]>(
    `SELECT
      (SELECT COUNT(*) FROM bg_user WHERE registered_at>=? AND registered_at<?) new_users,
      (SELECT COUNT(DISTINCT user_id) FROM (
        SELECT user_id FROM bg_login_log WHERE created_at>=? AND created_at<?
        UNION SELECT user_id FROM bg_568win_wallet_txn WHERE txn_type='bet' AND created_at>=? AND created_at<?
        UNION SELECT user_id FROM bg_deposit_order WHERE status='paid' AND created_at>=? AND created_at<?
      ) u) dau,
      (SELECT COUNT(DISTINCT d.user_id) FROM bg_deposit_order d
        JOIN (SELECT user_id, MIN(created_at) first_at FROM bg_deposit_order WHERE status='paid' GROUP BY user_id) f
          ON f.user_id=d.user_id AND f.first_at=d.created_at
        WHERE d.status='paid' AND d.created_at>=? AND d.created_at<?) first_dep_users`,
    [start, end, start, end, start, end, start, end, start, end],
  )
  s.newUsers = Number(users?.new_users ?? 0)
  s.dau = Number(users?.dau ?? 0)
  s.firstDepUsers = Number(users?.first_dep_users ?? 0)
  return s
}

export interface BiOverview {
  asOf: string
  today: BiWindowStats
  yesterdaySameTime: BiWindowStats
  lastWeekSameTime: BiWindowStats
  yesterdayFull: BiWindowStats
}

export async function getBiOverview(env: Env, redis: Redis): Promise<BiOverview> {
  const now = Date.now()
  const todayStart = manilaDayStartMs()
  const elapsed = now - todayStart
  const [today, yesterdaySameTime, lastWeekSameTime, yesterdayFull] = await Promise.all([
    windowStats(env, redis, todayStart, now),
    windowStats(env, redis, todayStart - DAY_MS, todayStart - DAY_MS + elapsed),
    windowStats(env, redis, todayStart - 7 * DAY_MS, todayStart - 7 * DAY_MS + elapsed),
    windowStats(env, redis, todayStart - DAY_MS, todayStart),
  ])
  return { asOf: new Date(now).toISOString(), today, yesterdaySameTime, lastWeekSameTime, yesterdayFull }
}

export interface BiTrendPoint {
  date: string
  deposit: number
  withdraw: number
  betAmount: number
  ggr: number
  bonusCost: number
  ngr: number
  dau: number
  newUsers: number
  firstDepUsers: number
}

export async function getBiTrends(
  env: Env,
  redis: Redis,
  opts: { days: number; granularity: 'day' | 'week' | 'month'; currency?: string },
): Promise<{ currency: string; series: BiTrendPoint[] }> {
  const db = pool(env)
  const fromDate = new Date(manilaDayStartMs(-(opts.days - 1)) + 8 * 3600 * 1000).toISOString().slice(0, 10)

  const params: unknown[] = [fromDate]
  let curFilter = ''
  if (opts.currency && opts.currency !== 'ALL') {
    curFilter = ' AND currency=?'
    params.push(opts.currency)
  }
  const [platRows] = await db.query<RowDataPacket[]>(
    `SELECT stat_date, currency, deposit_amount, withdraw_amount, bet_amount, payout_amount, bonus_cost, first_dep_users
     FROM bi_daily_platform WHERE stat_date>=?${curFilter} ORDER BY stat_date`,
    params,
  )
  const [activeRows] = await db.query<RowDataPacket[]>(
    `SELECT stat_date, new_users, dau FROM bi_daily_active WHERE stat_date>=? ORDER BY stat_date`,
    [fromDate],
  )

  const convert = opts.currency === undefined || opts.currency === 'ALL'
  const rates = convert
    ? await phpRates(redis, env, platRows.map((r) => String(r.currency)))
    : new Map<string, number>()
  const toDisplay = (cur: string, v: number) => (convert ? v * (rates.get(cur) ?? 1) : v)

  // 按粒度归桶：day=YYYY-MM-DD, week=该周周一, month=YYYY-MM-01
  const bucketOf = (d: Date): string => {
    if (opts.granularity === 'month') return `${d.toISOString().slice(0, 7)}-01`
    if (opts.granularity === 'week') {
      const day = (d.getUTCDay() + 6) % 7
      return new Date(d.getTime() - day * DAY_MS).toISOString().slice(0, 10)
    }
    return d.toISOString().slice(0, 10)
  }
  const dateStr = (v: unknown): Date => (v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00Z`))

  const buckets = new Map<string, BiTrendPoint>()
  const bucket = (key: string): BiTrendPoint => {
    let b = buckets.get(key)
    if (!b) {
      b = { date: key, deposit: 0, withdraw: 0, betAmount: 0, ggr: 0, bonusCost: 0, ngr: 0, dau: 0, newUsers: 0, firstDepUsers: 0 }
      buckets.set(key, b)
    }
    return b
  }
  for (const r of platRows) {
    const b = bucket(bucketOf(dateStr(r.stat_date)))
    const cur = String(r.currency)
    b.deposit += toDisplay(cur, Number(r.deposit_amount))
    b.withdraw += toDisplay(cur, Number(r.withdraw_amount))
    b.betAmount += toDisplay(cur, Number(r.bet_amount))
    b.ggr += toDisplay(cur, Number(r.bet_amount)) - toDisplay(cur, Number(r.payout_amount))
    b.bonusCost += toDisplay(cur, Number(r.bonus_cost))
    b.firstDepUsers += Number(r.first_dep_users)
  }
  for (const r of activeRows) {
    const b = bucket(bucketOf(dateStr(r.stat_date)))
    b.dau += Number(r.dau) // 周/月粒度为日均更合理，但求和口径先保持简单，前端标注「日累计」
    b.newUsers += Number(r.new_users)
  }
  for (const b of buckets.values()) b.ngr = b.ggr - b.bonusCost

  return {
    currency: convert ? 'PHP' : (opts.currency as string),
    series: [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}
