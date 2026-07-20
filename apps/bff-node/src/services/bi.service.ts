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

function fromDateOf(days: number): string {
  return new Date(manilaDayStartMs(-(days - 1)) + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

const dateKey = (v: unknown): string =>
  v instanceof Date ? new Date(v.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10) : String(v).slice(0, 10)

export interface BiProviderRow {
  provider: string
  betAmount: number
  payoutAmount: number
  ggr: number
  rtp: number | null
  betCount: number
  userDays: number
  share: number
}

export async function getBiProviders(
  env: Env,
  redis: Redis,
  opts: { days: number; currency?: string },
): Promise<{ currency: string; providers: BiProviderRow[]; trend: { dates: string[]; series: { name: string; ggr: number[] }[] } }> {
  const db = pool(env)
  const fromDate = fromDateOf(opts.days)
  const convert = !opts.currency || opts.currency === 'ALL'
  const curFilter = convert ? '' : ' AND currency=?'
  const params: unknown[] = convert ? [fromDate] : [fromDate, opts.currency]

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT provider, currency, SUM(bet_amount) stake, SUM(payout_amount) payout, SUM(bet_count) cnt, SUM(bet_users) user_days
     FROM bi_daily_provider WHERE stat_date>=?${curFilter} GROUP BY provider, currency`,
    params,
  )
  const rates = convert ? await phpRates(redis, env, rows.map((r) => String(r.currency))) : new Map<string, number>()
  const toDisplay = (cur: string, v: number) => (convert ? v * (rates.get(cur) ?? 1) : v)

  const byProvider = new Map<string, BiProviderRow>()
  for (const r of rows) {
    const cur = String(r.currency)
    let p = byProvider.get(String(r.provider))
    if (!p) {
      p = { provider: String(r.provider), betAmount: 0, payoutAmount: 0, ggr: 0, rtp: null, betCount: 0, userDays: 0, share: 0 }
      byProvider.set(p.provider, p)
    }
    p.betAmount += toDisplay(cur, Number(r.stake))
    p.payoutAmount += toDisplay(cur, Number(r.payout))
    p.betCount += Number(r.cnt)
    p.userDays += Number(r.user_days)
  }
  let total = 0
  for (const p of byProvider.values()) {
    p.ggr = p.betAmount - p.payoutAmount
    p.rtp = p.betAmount > 0 ? p.payoutAmount / p.betAmount : null
    total += p.betAmount
  }
  const providers = [...byProvider.values()].sort((a, b) => b.betAmount - a.betAmount)
  for (const p of providers) p.share = total > 0 ? p.betAmount / total : 0

  // Top 6 厂商 GGR 趋势
  const top = providers.slice(0, 6).map((p) => p.provider)
  const trendSeries: { name: string; ggr: number[] }[] = []
  const dates: string[] = []
  if (top.length > 0) {
    const [tRows] = await db.query<RowDataPacket[]>(
      `SELECT stat_date, provider, currency, bet_amount, payout_amount
       FROM bi_daily_provider WHERE stat_date>=?${curFilter} AND provider IN (?) ORDER BY stat_date`,
      convert ? [fromDate, top] : [fromDate, opts.currency, top],
    )
    const dateSet = new Set<string>()
    for (const r of tRows) dateSet.add(dateKey(r.stat_date))
    dates.push(...[...dateSet].sort())
    const idx = new Map(dates.map((d, i) => [d, i]))
    const byName = new Map<string, number[]>()
    for (const name of top) byName.set(name, dates.map(() => 0))
    for (const r of tRows) {
      const arr = byName.get(String(r.provider))
      const i = idx.get(dateKey(r.stat_date))
      if (!arr || i === undefined) continue
      const cur = String(r.currency)
      arr[i] += toDisplay(cur, Number(r.bet_amount)) - toDisplay(cur, Number(r.payout_amount))
    }
    for (const name of top) trendSeries.push({ name, ggr: (byName.get(name) ?? []).map((v) => Math.round(v * 100) / 100) })
  }

  return { currency: convert ? 'PHP' : (opts.currency as string), providers, trend: { dates, series: trendSeries } }
}

export interface BiGameRow {
  gpid: number
  gameId: number
  name: string
  provider: string
  category: string
  theoreticalRtp: number | null
  betAmount: number
  ggr: number
  rtp: number | null
  betCount: number
  userDays: number
  launchCount: number
  launchUsers: number
}

export async function getBiGames(
  env: Env,
  redis: Redis,
  opts: { days: number; currency?: string; limit: number },
): Promise<{ currency: string; games: BiGameRow[]; categories: { category: string; betAmount: number; ggr: number }[] }> {
  const db = pool(env)
  const fromDate = fromDateOf(opts.days)
  const convert = !opts.currency || opts.currency === 'ALL'
  const curFilter = convert ? '' : ' AND d.currency=?'
  const params: unknown[] = convert ? [fromDate] : [fromDate, opts.currency]

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT d.game_provider_id gpid, d.game_id, d.currency,
            SUM(d.bet_amount) stake, SUM(d.payout_amount) payout, SUM(d.bet_count) cnt, SUM(d.bet_users) user_days
     FROM bi_daily_game d WHERE d.stat_date>=?${curFilter} GROUP BY d.game_provider_id, d.game_id, d.currency`,
    params,
  )
  const rates = convert ? await phpRates(redis, env, rows.map((r) => String(r.currency))) : new Map<string, number>()
  const toDisplay = (cur: string, v: number) => (convert ? v * (rates.get(cur) ?? 1) : v)

  const byGame = new Map<string, BiGameRow>()
  for (const r of rows) {
    const key = `${r.gpid}:${r.game_id}`
    let g = byGame.get(key)
    if (!g) {
      g = { gpid: Number(r.gpid), gameId: Number(r.game_id), name: '', provider: '', category: '', theoreticalRtp: null,
            betAmount: 0, ggr: 0, rtp: null, betCount: 0, userDays: 0, launchCount: 0, launchUsers: 0 }
      byGame.set(key, g)
    }
    const cur = String(r.currency)
    g.betAmount += toDisplay(cur, Number(r.stake))
    g.ggr += toDisplay(cur, Number(r.stake)) - toDisplay(cur, Number(r.payout))
    g.betCount += Number(r.cnt)
    g.userDays += Number(r.user_days)
  }
  for (const g of byGame.values()) g.rtp = g.betAmount > 0 ? (g.betAmount - g.ggr) / g.betAmount : null

  const games = [...byGame.values()].sort((a, b) => b.betAmount - a.betAmount).slice(0, opts.limit)

  if (games.length > 0) {
    const pairConds = games.map(() => '(game_provider_id=? AND game_id=?)').join(' OR ')
    const pairParams = games.flatMap((g) => [g.gpid, g.gameId])
    const [metaRows] = await db.query<RowDataPacket[]>(
      `SELECT game_provider_id gpid, game_id, name_en, provider, site_category_auto, rtp FROM bg_568win_game WHERE ${pairConds}`,
      pairParams,
    )
    const meta = new Map(metaRows.map((m) => [`${m.gpid}:${m.game_id}`, m]))
    const uuids = games.map((g) => `568win:${g.gpid}:${g.gameId}`)
    const [launchRows] = await db.query<RowDataPacket[]>(
      `SELECT game_uuid, SUM(launch_count) launches, COUNT(*) users FROM bg_game_launch WHERE game_uuid IN (?) GROUP BY game_uuid`,
      [uuids],
    )
    const launches = new Map(launchRows.map((l) => [String(l.game_uuid), l]))
    for (const g of games) {
      const m = meta.get(`${g.gpid}:${g.gameId}`)
      g.name = m ? String(m.name_en ?? '') : `#${g.gpid}:${g.gameId}`
      g.provider = m ? String(m.provider ?? '') : 'Unknown'
      g.category = m ? String(m.site_category_auto ?? 'other') : 'other'
      g.theoreticalRtp = m && m.rtp != null ? Number(m.rtp) : null
      const l = launches.get(`568win:${g.gpid}:${g.gameId}`)
      g.launchCount = l ? Number(l.launches) : 0
      g.launchUsers = l ? Number(l.users) : 0
    }
  }

  // 品类占比（全部游戏，不止 Top N）
  const [catRows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(g.site_category_auto,'other') cat, d.currency, SUM(d.bet_amount) stake, SUM(d.payout_amount) payout
     FROM bi_daily_game d
     LEFT JOIN bg_568win_game g ON g.game_provider_id=d.game_provider_id AND g.game_id=d.game_id
     WHERE d.stat_date>=?${curFilter} GROUP BY COALESCE(g.site_category_auto,'other'), d.currency`,
    params,
  )
  const byCat = new Map<string, { category: string; betAmount: number; ggr: number }>()
  for (const r of catRows) {
    const cur = String(r.currency)
    let c = byCat.get(String(r.cat))
    if (!c) { c = { category: String(r.cat), betAmount: 0, ggr: 0 }; byCat.set(c.category, c) }
    c.betAmount += toDisplay(cur, Number(r.stake))
    c.ggr += toDisplay(cur, Number(r.stake)) - toDisplay(cur, Number(r.payout))
  }
  const categories = [...byCat.values()].sort((a, b) => b.betAmount - a.betAmount)

  return { currency: convert ? 'PHP' : (opts.currency as string), games, categories }
}

export interface BiAlertRow {
  id: number
  statDate: string
  alertType: string
  dimension: string
  currency: string
  value: number
  baseline: number
  deviation: number
  severity: string
  status: string
  createdAt: string
}

export async function listBiAlerts(env: Env, status?: string): Promise<BiAlertRow[]> {
  const db = pool(env)
  const cond = status ? ' WHERE status=?' : ''
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, stat_date, alert_type, dimension, currency, value, baseline, deviation, severity, status, created_at
     FROM bi_alert${cond} ORDER BY id DESC LIMIT 200`,
    status ? [status] : [],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    statDate: dateKey(r.stat_date),
    alertType: String(r.alert_type),
    dimension: String(r.dimension),
    currency: String(r.currency),
    value: Number(r.value),
    baseline: Number(r.baseline),
    deviation: Number(r.deviation),
    severity: String(r.severity),
    status: String(r.status),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }))
}

export async function setBiAlertStatus(env: Env, id: number, status: 'ack' | 'closed'): Promise<boolean> {
  const db = pool(env)
  const [res] = await db.execute<import('mysql2/promise').ResultSetHeader>(
    `UPDATE bi_alert SET status=? WHERE id=?`,
    [status, id],
  )
  return res.affectedRows > 0
}
