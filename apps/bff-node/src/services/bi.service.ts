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
// channel='admin' 是后台调整余额写入的 paid/completed 单，不是真实充值/提现，全部运营口径都要排除
const NOT_ADMIN = "channel<>'admin'"

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
       FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} AND created_at>=? AND created_at<? GROUP BY currency
     UNION ALL
     SELECT 'wd', currency, COUNT(*), COALESCE(SUM(amount),0), 0
       FROM bg_withdraw_order WHERE status IN ('completed','processing') AND ${NOT_ADMIN} AND created_at>=? AND created_at<? GROUP BY currency
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
        UNION SELECT user_id FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} AND created_at>=? AND created_at<?
      ) u) dau,
      (SELECT COUNT(DISTINCT d.user_id) FROM bg_deposit_order d
        JOIN (SELECT user_id, MIN(created_at) first_at FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} GROUP BY user_id) f
          ON f.user_id=d.user_id AND f.first_at=d.created_at
        WHERE d.status='paid' AND d.channel<>'admin' AND d.created_at>=? AND d.created_at<?) first_dep_users`,
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
      // 游戏表 rtp 为小数(0.96)，0/-1 为未知哨兵值
      g.theoreticalRtp = m && m.rtp != null && Number(m.rtp) > 0 ? Number(m.rtp) : null
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

// ---- P3 用户分析 ----

// 注册时间按马尼拉日归属
const REG_DAY = `DATE(DATE_ADD(u.registered_at, INTERVAL 8 HOUR))`

export interface BiFunnel {
  registered: number
  kycApproved: number
  firstDep: number
  redep: number
}

export async function getBiFunnel(env: Env, opts: { days: number; source?: string }): Promise<BiFunnel> {
  const db = pool(env)
  const startUtc = fmtUtc(manilaDayStartMs(-(opts.days - 1)))
  const srcFilter = opts.source && opts.source !== 'ALL' ? ' AND u.register_entry_source=?' : ''
  const params: unknown[] = opts.source && opts.source !== 'ALL' ? [startUtc, opts.source] : [startUtc]

  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) reg,
            COUNT(k.user_id) kyc,
            COUNT(CASE WHEN d.cnt>=1 THEN 1 END) first_dep,
            COUNT(CASE WHEN d.cnt>=2 THEN 1 END) redep
     FROM bg_user u
     LEFT JOIN bg_kyc k ON k.user_id=u.id AND k.status='approved'
     LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} GROUP BY user_id) d ON d.user_id=u.id
     WHERE u.registered_at>=?${srcFilter}`,
    params,
  )
  return {
    registered: Number(row?.reg ?? 0),
    kycApproved: Number(row?.kyc ?? 0),
    firstDep: Number(row?.first_dep ?? 0),
    redep: Number(row?.redep ?? 0),
  }
}

export interface BiRetentionCohort {
  week: string
  size: number
  d1: number; d3: number; d7: number; d14: number; d30: number
}

export async function getBiRetention(env: Env, weeks: number): Promise<BiRetentionCohort[]> {
  const db = pool(env)
  const startUtc = fmtUtc(manilaDayStartMs(-(weeks * 7 - 1)))
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(DATE_ADD(u.registered_at, INTERVAL 8 HOUR), '%x-W%v') wk,
            COUNT(DISTINCT u.id) size,
            COUNT(DISTINCT CASE WHEN DATEDIFF(a.stat_date, ${REG_DAY})=1  THEN u.id END) d1,
            COUNT(DISTINCT CASE WHEN DATEDIFF(a.stat_date, ${REG_DAY})=3  THEN u.id END) d3,
            COUNT(DISTINCT CASE WHEN DATEDIFF(a.stat_date, ${REG_DAY})=7  THEN u.id END) d7,
            COUNT(DISTINCT CASE WHEN DATEDIFF(a.stat_date, ${REG_DAY})=14 THEN u.id END) d14,
            COUNT(DISTINCT CASE WHEN DATEDIFF(a.stat_date, ${REG_DAY})=30 THEN u.id END) d30
     FROM bg_user u
     LEFT JOIN bi_user_active_day a ON a.user_id=u.id
       AND DATEDIFF(a.stat_date, ${REG_DAY}) IN (1,3,7,14,30)
     WHERE u.registered_at>=?
     GROUP BY wk ORDER BY wk`,
    [startUtc],
  )
  return rows.map((r) => ({
    week: String(r.wk), size: Number(r.size),
    d1: Number(r.d1), d3: Number(r.d3), d7: Number(r.d7), d14: Number(r.d14), d30: Number(r.d30),
  }))
}

export interface BiRfmCell {
  valueTier: string   // whale | mid | small
  recency: string     // active | cooling | churned
  users: number
  depositAmount: number
}

export async function getBiRfm(
  env: Env, redis: Redis, days: number,
): Promise<{ cells: BiRfmCell[]; nonDepositors: number; totalUsers: number }> {
  const db = pool(env)
  const startUtc = fmtUtc(manilaDayStartMs(-(days - 1)))
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, currency, SUM(amount) amt, MAX(created_at) last_at
     FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} AND created_at>=? GROUP BY user_id, currency`,
    [startUtc],
  )
  const rates = await phpRates(redis, env, rows.map((r) => String(r.currency)))
  const byUser = new Map<string, { total: number; lastAt: number }>()
  for (const r of rows) {
    const u = byUser.get(String(r.user_id)) ?? { total: 0, lastAt: 0 }
    u.total += Number(r.amt) * (rates.get(String(r.currency)) ?? 1)
    u.lastAt = Math.max(u.lastAt, new Date(r.last_at as string).getTime())
    byUser.set(String(r.user_id), u)
  }

  const now = Date.now()
  const cellMap = new Map<string, BiRfmCell>()
  for (const u of byUser.values()) {
    const valueTier = u.total >= 50000 ? 'whale' : u.total >= 5000 ? 'mid' : 'small'
    const idleDays = (now - u.lastAt) / DAY_MS
    const recency = idleDays <= 7 ? 'active' : idleDays <= 30 ? 'cooling' : 'churned'
    const key = `${valueTier}|${recency}`
    let c = cellMap.get(key)
    if (!c) { c = { valueTier, recency, users: 0, depositAmount: 0 }; cellMap.set(key, c) }
    c.users++
    c.depositAmount += u.total
  }

  const [[cnt]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM bg_user`)
  const totalUsers = Number(cnt?.c ?? 0)
  return { cells: [...cellMap.values()], nonDepositors: totalUsers - byUser.size, totalUsers }
}

export interface BiLtvCohort {
  week: string
  size: number
  d7: number; d30: number; d60: number; d90: number  // 人均累计 NGR (PHP)
}

export async function getBiLtv(env: Env, redis: Redis, weeks: number): Promise<BiLtvCohort[]> {
  const db = pool(env)
  const startUtc = fmtUtc(manilaDayStartMs(-(weeks * 7 - 1)))
  const [sizeRows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(DATE_ADD(u.registered_at, INTERVAL 8 HOUR), '%x-W%v') wk, COUNT(*) size
     FROM bg_user u WHERE u.registered_at>=? GROUP BY wk`,
    [startUtc],
  )
  const [valRows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(DATE_ADD(u.registered_at, INTERVAL 8 HOUR), '%x-W%v') wk, d.currency,
            SUM(CASE WHEN DATEDIFF(d.stat_date, ${REG_DAY})<7  THEN d.bet_amount-d.payout_amount-d.bonus_amount ELSE 0 END) v7,
            SUM(CASE WHEN DATEDIFF(d.stat_date, ${REG_DAY})<30 THEN d.bet_amount-d.payout_amount-d.bonus_amount ELSE 0 END) v30,
            SUM(CASE WHEN DATEDIFF(d.stat_date, ${REG_DAY})<60 THEN d.bet_amount-d.payout_amount-d.bonus_amount ELSE 0 END) v60,
            SUM(CASE WHEN DATEDIFF(d.stat_date, ${REG_DAY})<90 THEN d.bet_amount-d.payout_amount-d.bonus_amount ELSE 0 END) v90
     FROM bg_user u
     JOIN bi_daily_user d ON d.user_id=u.id AND DATEDIFF(d.stat_date, ${REG_DAY}) BETWEEN 0 AND 89
     WHERE u.registered_at>=?
     GROUP BY wk, d.currency`,
    [startUtc],
  )
  const rates = await phpRates(redis, env, valRows.map((r) => String(r.currency)))
  const agg = new Map<string, { v7: number; v30: number; v60: number; v90: number }>()
  for (const r of valRows) {
    const rate = rates.get(String(r.currency)) ?? 1
    const a = agg.get(String(r.wk)) ?? { v7: 0, v30: 0, v60: 0, v90: 0 }
    a.v7 += Number(r.v7) * rate
    a.v30 += Number(r.v30) * rate
    a.v60 += Number(r.v60) * rate
    a.v90 += Number(r.v90) * rate
    agg.set(String(r.wk), a)
  }
  return sizeRows
    .map((s) => {
      const size = Number(s.size)
      const a = agg.get(String(s.wk)) ?? { v7: 0, v30: 0, v60: 0, v90: 0 }
      const per = (v: number) => (size > 0 ? Math.round((v / size) * 100) / 100 : 0)
      return { week: String(s.wk), size, d7: per(a.v7), d30: per(a.v30), d60: per(a.v60), d90: per(a.v90) }
    })
    .sort((a, b) => a.week.localeCompare(b.week))
}

export interface BiTopWinner {
  userId: string
  displayName: string
  netWin: number
  betAmount: number
}

export async function getBiTopWinners(env: Env, redis: Redis, days: number): Promise<BiTopWinner[]> {
  const db = pool(env)
  const fromDate = fromDateOf(days)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, currency, SUM(payout_amount-bet_amount) net_win, SUM(bet_amount) stake
     FROM bi_daily_user WHERE stat_date>=? GROUP BY user_id, currency`,
    [fromDate],
  )
  const rates = await phpRates(redis, env, rows.map((r) => String(r.currency)))
  const byUser = new Map<string, { netWin: number; betAmount: number }>()
  for (const r of rows) {
    const rate = rates.get(String(r.currency)) ?? 1
    const u = byUser.get(String(r.user_id)) ?? { netWin: 0, betAmount: 0 }
    u.netWin += Number(r.net_win) * rate
    u.betAmount += Number(r.stake) * rate
    byUser.set(String(r.user_id), u)
  }
  const top = [...byUser.entries()].sort((a, b) => b[1].netWin - a[1].netWin).slice(0, 20)
  if (top.length === 0) return []
  const [names] = await db.query<RowDataPacket[]>(
    `SELECT id, display_name FROM bg_user WHERE id IN (?)`,
    [top.map(([id]) => id)],
  )
  const nameMap = new Map(names.map((n) => [String(n.id), String(n.display_name ?? '')]))
  return top.map(([userId, v]) => ({
    userId,
    displayName: nameMap.get(userId) ?? '',
    netWin: Math.round(v.netWin * 100) / 100,
    betAmount: Math.round(v.betAmount * 100) / 100,
  }))
}

// ---- P5 支付通道监控 ----

export interface BiChannelRow {
  direction: string
  channel: string
  total: number
  success: number
  rate: number
  avgSecs: number | null
}

export async function getBiChannels(
  env: Env, days: number,
): Promise<{ channels: BiChannelRow[]; trend: { dates: string[]; series: { name: string; data: (number | null)[] }[] } }> {
  const db = pool(env)
  const fromDate = fromDateOf(days)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT direction, channel, SUM(total) total, SUM(success) success,
            ROUND(SUM(avg_secs*success)/NULLIF(SUM(success),0)) avg_secs
     FROM bi_daily_channel WHERE stat_date>=? GROUP BY direction, channel ORDER BY total DESC`,
    [fromDate],
  )
  const channels: BiChannelRow[] = rows.map((r) => ({
    direction: String(r.direction),
    channel: String(r.channel),
    total: Number(r.total),
    success: Number(r.success),
    rate: Number(r.total) > 0 ? Number(r.success) / Number(r.total) : 0,
    avgSecs: r.avg_secs == null ? null : Number(r.avg_secs),
  }))

  // Top 5 通道每日成功率趋势（无单日置 null 断线）
  const top = channels.slice(0, 5)
  const dates: string[] = []
  const series: { name: string; data: (number | null)[] }[] = []
  if (top.length > 0) {
    const [dRows] = await db.query<RowDataPacket[]>(
      `SELECT stat_date, direction, channel, total, success FROM bi_daily_channel WHERE stat_date>=? ORDER BY stat_date`,
      [fromDate],
    )
    const dateSet = new Set<string>()
    for (const r of dRows) dateSet.add(dateKey(r.stat_date))
    dates.push(...[...dateSet].sort())
    const idx = new Map(dates.map((d, i) => [d, i]))
    for (const t of top) {
      const key = `${t.direction}:${t.channel}`
      const data: (number | null)[] = dates.map(() => null)
      for (const r of dRows) {
        if (`${r.direction}:${r.channel}` !== key) continue
        const i = idx.get(dateKey(r.stat_date))
        if (i !== undefined && Number(r.total) > 0) data[i] = Math.round((Number(r.success) / Number(r.total)) * 1000) / 10
      }
      series.push({ name: key, data })
    }
  }
  return { channels, trend: { dates, series } }
}

// ---- P4 预测层 ----

/** 近 N 天平台日汇总（折算 PHP），预测与目标进度共用 */
async function dailyPhpTotals(
  env: Env, redis: Redis, fromDate: string,
  metric: 'ggr' | 'deposit' | 'new_users' | 'first_dep_users',
): Promise<Map<string, number>> {
  const db = pool(env)
  const out = new Map<string, number>()
  if (metric === 'new_users') {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT stat_date, new_users v FROM bi_daily_active WHERE stat_date>=?`, [fromDate])
    for (const r of rows) out.set(dateKey(r.stat_date), Number(r.v))
    return out
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT stat_date, currency, deposit_amount, bet_amount, payout_amount, first_dep_users
     FROM bi_daily_platform WHERE stat_date>=?`, [fromDate])
  const rates = await phpRates(redis, env, rows.map((r) => String(r.currency)))
  for (const r of rows) {
    const d = dateKey(r.stat_date)
    const rate = rates.get(String(r.currency)) ?? 1
    const v = metric === 'deposit' ? Number(r.deposit_amount) * rate
      : metric === 'first_dep_users' ? Number(r.first_dep_users)
      : (Number(r.bet_amount) - Number(r.payout_amount)) * rate
    out.set(d, (out.get(d) ?? 0) + v)
  }
  return out
}

export interface BiForecastPoint { date: string; value: number }

/** 星期季节性加权移动平均：取近 4 个同星期日加权(4,3,2,1)，样本不足退化为近 7 日均值 */
function forecastDays(totals: Map<string, number>, horizon: number): BiForecastPoint[] {
  const todayMs = manilaDayStartMs() + 8 * 3600 * 1000
  const hist: { date: string; dow: number; value: number }[] = []
  for (const [date, value] of totals) {
    if (date >= new Date(todayMs).toISOString().slice(0, 10)) continue // 今天未完整,不进历史
    hist.push({ date, dow: new Date(`${date}T00:00:00Z`).getUTCDay(), value })
  }
  hist.sort((a, b) => a.date.localeCompare(b.date))
  const last7 = hist.slice(-7)
  const fallback = last7.length > 0 ? last7.reduce((a, b) => a + b.value, 0) / last7.length : 0

  const out: BiForecastPoint[] = []
  for (let i = 0; i < horizon; i++) {
    const ms = todayMs + i * DAY_MS
    const date = new Date(ms).toISOString().slice(0, 10)
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
    const samples = hist.filter((h) => h.dow === dow).slice(-4).reverse() // 最近在前
    let value = fallback
    if (samples.length >= 2) {
      const weights = [4, 3, 2, 1]
      let num = 0; let den = 0
      samples.forEach((s, j) => { num += s.value * weights[j]; den += weights[j] })
      value = num / den
    }
    out.push({ date, value: Math.round(value * 100) / 100 })
  }
  return out
}

export async function getBiForecast(
  env: Env, redis: Redis, metric: 'ggr' | 'deposit',
): Promise<{ history: BiForecastPoint[]; forecast: BiForecastPoint[] }> {
  const totals = await dailyPhpTotals(env, redis, fromDateOf(56), metric)
  const history = [...totals.entries()]
    .map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)
  return { history, forecast: forecastDays(totals, 7) }
}

// ---- P4 月度目标 ----

export const BI_TARGET_METRICS = ['ggr', 'deposit', 'new_users', 'first_dep_users'] as const
export type BiTargetMetric = (typeof BI_TARGET_METRICS)[number]

export async function listBiTargets(env: Env, period: string): Promise<{ metric: string; targetValue: number }[]> {
  const [rows] = await pool(env).query<RowDataPacket[]>(
    `SELECT metric, target_value FROM bi_target WHERE period=?`, [period])
  return rows.map((r) => ({ metric: String(r.metric), targetValue: Number(r.target_value) }))
}

export async function upsertBiTarget(env: Env, period: string, metric: BiTargetMetric, value: number, by: string): Promise<void> {
  await pool(env).execute(
    `INSERT INTO bi_target (period, metric, target_value, created_by) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE target_value=VALUES(target_value), created_by=VALUES(created_by)`,
    [period, metric, value, by])
}

export interface BiTargetProgress {
  metric: string
  target: number
  actual: number
  timeProgress: number       // 时间进度 0-1
  completion: number         // 完成率 0-1
  requiredDaily: number      // 剩余天数每日需达成
  projected: number          // 按预测跑完全月的预计值
  projectedCompletion: number
}

export async function getBiTargetProgress(env: Env, redis: Redis): Promise<{ period: string; items: BiTargetProgress[] }> {
  const todayStr = new Date(manilaDayStartMs() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const period = todayStr.slice(0, 7)
  const monthStart = `${period}-01`
  const daysInMonth = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()
  const dayOfMonth = Number(todayStr.slice(8, 10))
  const remainingDays = daysInMonth - dayOfMonth // 今天不算(未完整)

  const targets = await listBiTargets(env, period)
  const items: BiTargetProgress[] = []
  for (const t of targets) {
    const metric = t.metric as BiTargetMetric
    if (!BI_TARGET_METRICS.includes(metric)) continue
    const totals = await dailyPhpTotals(env, redis, monthStart, metric)
    let actual = 0
    for (const v of totals.values()) actual += v
    const fc = forecastDays(totals, Math.max(remainingDays, 0))
    const projected = actual + fc.reduce((a, b) => a + b.value, 0)
    items.push({
      metric,
      target: t.targetValue,
      actual: Math.round(actual * 100) / 100,
      timeProgress: dayOfMonth / daysInMonth,
      completion: t.targetValue > 0 ? actual / t.targetValue : 0,
      requiredDaily: remainingDays > 0 ? Math.max(0, (t.targetValue - actual) / remainingDays) : 0,
      projected: Math.round(projected * 100) / 100,
      projectedCompletion: t.targetValue > 0 ? projected / t.targetValue : 0,
    })
  }
  return { period, items }
}

// ---- P4 流失预警 ----

export interface BiChurnUser {
  userId: string
  displayName: string
  deposit90d: number
  lastActive: string
  idleDays: number
  cadenceDays: number
  score: number
}

export async function getBiChurnRisk(env: Env, redis: Redis): Promise<BiChurnUser[]> {
  const db = pool(env)
  const fromDate = fromDateOf(60)
  const todayStr = new Date(manilaDayStartMs() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const [actRows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, MIN(stat_date) first_d, MAX(stat_date) last_d, COUNT(*) days
     FROM bi_user_active_day WHERE stat_date>=? GROUP BY user_id HAVING days>=3`,
    [fromDate],
  )
  const candidates: Omit<BiChurnUser, 'displayName' | 'deposit90d'>[] = []
  for (const r of actRows) {
    const first = dateKey(r.first_d)
    const last = dateKey(r.last_d)
    const days = Number(r.days)
    const spanDays = Math.max(1, (Date.parse(last) - Date.parse(first)) / DAY_MS)
    const cadence = Math.max(1, spanDays / Math.max(days - 1, 1)) // 活跃日平均间隔
    const idleDays = Math.round((Date.parse(todayStr) - Date.parse(last)) / DAY_MS)
    if (idleDays < 3 || idleDays < 2 * cadence) continue
    candidates.push({
      userId: String(r.user_id),
      lastActive: last,
      idleDays,
      cadenceDays: Math.round(cadence * 10) / 10,
      score: Math.min(100, Math.round((idleDays / cadence) * 25)),
    })
  }
  if (candidates.length === 0) return []

  const ids = candidates.map((c) => c.userId)
  const [depRows] = await db.query<RowDataPacket[]>(
    `SELECT user_id, currency, SUM(amount) amt FROM bg_deposit_order
     WHERE status='paid' AND ${NOT_ADMIN} AND user_id IN (?) AND created_at>=? GROUP BY user_id, currency`,
    [ids, fmtUtc(manilaDayStartMs(-89))],
  )
  const rates = await phpRates(redis, env, depRows.map((r) => String(r.currency)))
  const depMap = new Map<string, number>()
  for (const r of depRows) {
    depMap.set(String(r.user_id), (depMap.get(String(r.user_id)) ?? 0) + Number(r.amt) * (rates.get(String(r.currency)) ?? 1))
  }
  const [nameRows] = await db.query<RowDataPacket[]>(`SELECT id, display_name FROM bg_user WHERE id IN (?)`, [ids])
  const nameMap = new Map(nameRows.map((n) => [String(n.id), String(n.display_name ?? '')]))

  return candidates
    .map((c) => ({
      ...c,
      displayName: nameMap.get(c.userId) ?? '',
      deposit90d: Math.round((depMap.get(c.userId) ?? 0) * 100) / 100,
    }))
    .sort((a, b) => b.deposit90d - a.deposit90d || b.score - a.score)
    .slice(0, 100)
}

/** 定向给用户开一个复充优惠窗口（绕过进站触发的冷却限制，用于流失挽回） */
export async function grantRedepOffer(
  env: Env, userId: string, currency: string,
): Promise<{ ok: boolean; reason?: string; bonusAmount?: number; minDeposit?: number; endsAt?: string }> {
  const db = pool(env)
  const { getRedepConfigByPool } = await import('./promo-config.service.js')
  const cfg = await getRedepConfigByPool(db)
  const tier = cfg.byCcy?.[currency] ?? { minDeposit: cfg.minDeposit, bonusAmount: cfg.bonusAmount }
  if (tier.bonusAmount <= 0 || tier.minDeposit <= 0) return { ok: false, reason: '该币种复充优惠未配置' }

  const [openRows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM bg_redep_offer WHERE user_id=? AND currency=? AND claimed_at IS NULL AND ends_at>NOW(3) LIMIT 1`,
    [userId, currency],
  )
  if (openRows.length > 0) return { ok: false, reason: '该用户已有生效中的复充窗口' }

  const [ins] = await db.query<import('mysql2/promise').ResultSetHeader>(
    `INSERT INTO bg_redep_offer (user_id, currency, min_deposit, bonus_amount, starts_at, ends_at)
     VALUES (?,?,?,?,NOW(3),DATE_ADD(NOW(3), INTERVAL ? HOUR))`,
    [userId, currency, tier.minDeposit, tier.bonusAmount, cfg.windowHours],
  )
  const [[row]] = await db.query<RowDataPacket[]>(`SELECT ends_at FROM bg_redep_offer WHERE id=?`, [ins.insertId])
  return {
    ok: true,
    bonusAmount: tier.bonusAmount,
    minDeposit: tier.minDeposit,
    endsAt: row?.ends_at instanceof Date ? row.ends_at.toISOString() : String(row?.ends_at),
  }
}

// ---- P3 渠道拉新（渠道=入口域名/tma）----

export interface BiAcquisitionRow {
  source: string
  newUsers: number
  firstDepUsers: number
  conversion: number | null
  bonusCost: number
  ngr: number
}

export async function getBiAcquisition(
  env: Env, redis: Redis, days: number,
): Promise<{ sources: BiAcquisitionRow[]; dauTrend: { dates: string[]; series: { name: string; data: number[] }[] } }> {
  const db = pool(env)
  const fromDate = fromDateOf(days)
  const startUtc = fmtUtc(manilaDayStartMs(-(days - 1)))

  const [totalRows] = await db.query<RowDataPacket[]>(
    `SELECT entry_source, SUM(new_users) nu, SUM(first_dep_users) fd
     FROM bi_daily_acquisition WHERE stat_date>=? GROUP BY entry_source`,
    [fromDate],
  )
  // 期间彩金成本 / NGR，按用户注册入口归因（含老用户，口径=该来源全部用户的区间值）
  const [costRows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(u.register_entry_source,'unknown') src, l.currency, SUM(l.amount) amt
     FROM bg_wallet_ledger l JOIN bg_user u ON u.id=l.user_id
     WHERE l.type IN (${BONUS_LEDGER_TYPES}) AND l.amount>0 AND l.created_at>=?
     GROUP BY src, l.currency`,
    [startUtc],
  )
  const [ngrRows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(u.register_entry_source,'unknown') src, d.currency,
            SUM(d.bet_amount-d.payout_amount-d.bonus_amount) ngr
     FROM bi_daily_user d JOIN bg_user u ON u.id=d.user_id
     WHERE d.stat_date>=? GROUP BY src, d.currency`,
    [fromDate],
  )
  const rates = await phpRates(redis, env, [...costRows, ...ngrRows].map((r) => String(r.currency)))

  const map = new Map<string, BiAcquisitionRow>()
  const rowOf = (src: string) => {
    let r = map.get(src)
    if (!r) { r = { source: src, newUsers: 0, firstDepUsers: 0, conversion: null, bonusCost: 0, ngr: 0 }; map.set(src, r) }
    return r
  }
  for (const r of totalRows) {
    const row = rowOf(String(r.entry_source))
    row.newUsers += Number(r.nu)
    row.firstDepUsers += Number(r.fd)
  }
  for (const r of costRows) rowOf(String(r.src)).bonusCost += Number(r.amt) * (rates.get(String(r.currency)) ?? 1)
  for (const r of ngrRows) rowOf(String(r.src)).ngr += Number(r.ngr) * (rates.get(String(r.currency)) ?? 1)
  for (const r of map.values()) r.conversion = r.newUsers > 0 ? r.firstDepUsers / r.newUsers : null
  const sources = [...map.values()].sort((a, b) => b.newUsers - a.newUsers)

  // 各来源 DAU 趋势（Top 6）
  const topSources = sources.slice(0, 6).map((s) => s.source)
  const dates: string[] = []
  const series: { name: string; data: number[] }[] = []
  if (topSources.length > 0) {
    const [dauRows] = await db.query<RowDataPacket[]>(
      `SELECT stat_date, entry_source, dau FROM bi_daily_acquisition
       WHERE stat_date>=? AND entry_source IN (?) ORDER BY stat_date`,
      [fromDate, topSources],
    )
    const dateSet = new Set<string>()
    for (const r of dauRows) dateSet.add(dateKey(r.stat_date))
    dates.push(...[...dateSet].sort())
    const idx = new Map(dates.map((d, i) => [d, i]))
    const byName = new Map<string, number[]>(topSources.map((s) => [s, dates.map(() => 0)]))
    for (const r of dauRows) {
      const arr = byName.get(String(r.entry_source))
      const i = idx.get(dateKey(r.stat_date))
      if (arr && i !== undefined) arr[i] = Number(r.dau)
    }
    for (const s of topSources) series.push({ name: s, data: byName.get(s) ?? [] })
  }

  return { sources, dauTrend: { dates, series } }
}
