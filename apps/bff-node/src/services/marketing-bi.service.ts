// 买量渠道 BI：按 channel_code（投手渠道）× 马尼拉日实时统计投放核心指标。
// 与 bi_daily_* 聚合表不同，这里直接查业务表——投放要看当天实时消耗，10 分钟延迟的
// 预聚合不够用；且单渠道数据量小，走 bg_user_attribution.idx_channel_created 索引足够快。
//
// 指标口径对齐投放合作条款：
//   注册数     = 当日归因到该渠道的新注册（attribution.created_at 即注册时刻，仅 isNewUser 写入）
//   首存人数   = 平台历史首笔成功充值发生在当日、且归因到该渠道的人
//   客均       = 当日该渠道所有用户的充值总额 ÷ 首存人数
//   首存成本   = 广告花费在投手侧，我方只给首存数；成本由投手用「花费 ÷ 首存数」自算
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'

const DAY_MS = 24 * 60 * 60 * 1000

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/** 马尼拉某天 0 点的 UTC 毫秒（offsetDays 相对今天） */
function manilaDayStartMs(offsetDays = 0): number {
  const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  return Date.parse(`${date}T00:00:00+08:00`) + offsetDays * DAY_MS
}

/** UTC 时间戳 → 所属马尼拉日 YYYY-MM-DD */
function manilaDateOf(d: Date): string {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** DATE 列 → YYYY-MM-DD（mysql2 可能回字符串或 UTC 午夜 Date） */
function dateKey(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 10)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

export interface AdSourceRow {
  channelCode: string
  /** APK 下载点击数（bg_pending_install，按点击日归属） */
  downloads: number
  /** 其中 App 首启配对成功数（≈实际安装打开数） */
  installs: number
  regUsers: number
  firstDepUsers: number
  firstDepAmount: number
  depositAmount: number
  depositUsers: number
  /** 客均 = depositAmount / firstDepUsers；首存人数为 0 时为 null */
  arpu: number | null
}

export interface AdSourceReport {
  from: string
  to: string
  currency: string
  rows: AdSourceRow[]
  totals: Omit<AdSourceRow, 'channelCode'>
}

function isValidChannel(c: string): boolean {
  return /^[\w.-]{1,64}$/.test(c)
}

/**
 * 渠道汇总报表：给定马尼拉日范围 [from, to]（含端点），按 channel_code 聚合。
 * currency 固定单币种（投放默认 PHP，客均门槛即 PHP 口径）；channel 省略则返回全部渠道。
 */
export async function getAdSourceReport(
  env: Env,
  opts: { from: string; to: string; currency: string; channel?: string },
): Promise<AdSourceReport> {
  const db = pool(env)
  const { currency } = opts
  // from/to 是马尼拉日；转成 UTC 半开区间 [start, end)
  const startMs = Date.parse(`${opts.from}T00:00:00+08:00`)
  const endMs = Date.parse(`${opts.to}T00:00:00+08:00`) + DAY_MS
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)
  const chanFilter = opts.channel ? ' AND a.channel_code=?' : ''
  const chanArg = opts.channel ? [opts.channel] : []

  const map = new Map<string, AdSourceRow>()
  const rowOf = (code: string): AdSourceRow => {
    let r = map.get(code)
    if (!r) {
      r = { channelCode: code, downloads: 0, installs: 0, regUsers: 0, firstDepUsers: 0, firstDepAmount: 0, depositAmount: 0, depositUsers: 0, arpu: null }
      map.set(code, r)
    }
    return r
  }

  // 下载/安装：bg_pending_install 每行=一次 APK 下载点击，matched_at 非空=App 首启配对成功。
  // 渠道码在 attr_json 快照里（$.c 采集时已做 utm_source 兜底）；表只有买量下载点击，量小，JSON 提取够用
  const pChanFilter = opts.channel ? " AND JSON_UNQUOTE(JSON_EXTRACT(p.attr_json,'$.c'))=?" : ''
  const [dlRows] = await db.query<RowDataPacket[]>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(p.attr_json,'$.c')) code,
            COUNT(*) dl, COUNT(p.matched_at) inst
     FROM bg_pending_install p
     WHERE p.created_at>=? AND p.created_at<?
       AND JSON_UNQUOTE(JSON_EXTRACT(p.attr_json,'$.c')) IS NOT NULL${pChanFilter}
     GROUP BY code`,
    [start, end, ...chanArg],
  )
  for (const r of dlRows) {
    const row = rowOf(String(r.code))
    row.downloads = Number(r.dl)
    row.installs = Number(r.inst)
  }

  // 注册数：attribution.created_at 即注册时刻
  const [regRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, COUNT(*) cnt
     FROM bg_user_attribution a
     WHERE a.channel_code IS NOT NULL AND a.created_at>=? AND a.created_at<?${chanFilter}
     GROUP BY a.channel_code`,
    [start, end, ...chanArg],
  )
  for (const r of regRows) rowOf(String(r.code)).regUsers = Number(r.cnt)

  // 当日充值（指定币种）：该渠道用户当日全部成功充值的额与人数
  const [depRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, COALESCE(SUM(d.amount),0) amt, COUNT(DISTINCT d.user_id) users
     FROM bg_deposit_order d
     JOIN bg_user_attribution a ON a.user_id=d.user_id
     WHERE d.status='paid' AND d.currency=? AND d.created_at>=? AND d.created_at<?
       AND a.channel_code IS NOT NULL${chanFilter}
     GROUP BY a.channel_code`,
    [currency, start, end, ...chanArg],
  )
  for (const r of depRows) {
    const row = rowOf(String(r.code))
    row.depositAmount = Number(r.amt)
    row.depositUsers = Number(r.users)
  }

  // 首存：平台历史首笔成功充值在当日窗口内（NOT EXISTS 更早的 paid 单），且币种匹配
  const [fdRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, COUNT(DISTINCT d.user_id) users, COALESCE(SUM(d.amount),0) amt
     FROM bg_deposit_order d
     JOIN bg_user_attribution a ON a.user_id=d.user_id
     WHERE d.status='paid' AND d.currency=? AND d.created_at>=? AND d.created_at<?
       AND a.channel_code IS NOT NULL${chanFilter}
       AND NOT EXISTS (
         SELECT 1 FROM bg_deposit_order d2
         WHERE d2.user_id=d.user_id AND d2.status='paid' AND d2.created_at<d.created_at
       )
     GROUP BY a.channel_code`,
    [currency, start, end, ...chanArg],
  )
  for (const r of fdRows) {
    const row = rowOf(String(r.code))
    row.firstDepUsers = Number(r.users)
    row.firstDepAmount = Number(r.amt)
  }

  const rows = [...map.values()]
  for (const r of rows) r.arpu = r.firstDepUsers > 0 ? r.depositAmount / r.firstDepUsers : null
  rows.sort((a, b) => b.firstDepUsers - a.firstDepUsers || b.regUsers - a.regUsers)

  const totals = rows.reduce(
    (t, r) => {
      t.downloads += r.downloads
      t.installs += r.installs
      t.regUsers += r.regUsers
      t.firstDepUsers += r.firstDepUsers
      t.firstDepAmount += r.firstDepAmount
      t.depositAmount += r.depositAmount
      t.depositUsers += r.depositUsers
      return t
    },
    { downloads: 0, installs: 0, regUsers: 0, firstDepUsers: 0, firstDepAmount: 0, depositAmount: 0, depositUsers: 0, arpu: null as number | null },
  )
  totals.arpu = totals.firstDepUsers > 0 ? totals.depositAmount / totals.firstDepUsers : null

  return { from: opts.from, to: opts.to, currency, rows, totals }
}

export interface AdSourceTrendPoint {
  date: string
  regUsers: number
  firstDepUsers: number
  depositAmount: number
  arpu: number | null
}

/**
 * 单渠道逐日趋势，用于投手面板画曲线。channel 必填。
 */
export async function getAdSourceTrend(
  env: Env,
  opts: { channel: string; from: string; to: string; currency: string },
): Promise<{ channel: string; currency: string; points: AdSourceTrendPoint[] }> {
  const db = pool(env)
  const { channel, currency } = opts
  const startMs = Date.parse(`${opts.from}T00:00:00+08:00`)
  const endMs = Date.parse(`${opts.to}T00:00:00+08:00`) + DAY_MS
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)

  // 预建全部日期槽，无数据的日子补 0，曲线不断点
  const byDate = new Map<string, AdSourceTrendPoint>()
  for (let ms = startMs; ms < endMs; ms += DAY_MS) {
    const d = new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
    byDate.set(d, { date: d, regUsers: 0, firstDepUsers: 0, depositAmount: 0, arpu: null })
  }

  const [regRows] = await db.query<RowDataPacket[]>(
    `SELECT a.created_at ca FROM bg_user_attribution a
     WHERE a.channel_code=? AND a.created_at>=? AND a.created_at<?`,
    [channel, start, end],
  )
  for (const r of regRows) {
    const p = byDate.get(manilaDateOf(new Date(r.ca)))
    if (p) p.regUsers += 1
  }

  const [depRows] = await db.query<RowDataPacket[]>(
    `SELECT d.created_at ca, d.amount amt
     FROM bg_deposit_order d JOIN bg_user_attribution a ON a.user_id=d.user_id
     WHERE a.channel_code=? AND d.status='paid' AND d.currency=? AND d.created_at>=? AND d.created_at<?`,
    [channel, currency, start, end],
  )
  for (const r of depRows) {
    const p = byDate.get(manilaDateOf(new Date(r.ca)))
    if (p) p.depositAmount += Number(r.amt)
  }

  const [fdRows] = await db.query<RowDataPacket[]>(
    `SELECT d.created_at ca
     FROM bg_deposit_order d JOIN bg_user_attribution a ON a.user_id=d.user_id
     WHERE a.channel_code=? AND d.status='paid' AND d.currency=? AND d.created_at>=? AND d.created_at<?
       AND NOT EXISTS (
         SELECT 1 FROM bg_deposit_order d2
         WHERE d2.user_id=d.user_id AND d2.status='paid' AND d2.created_at<d.created_at
       )`,
    [channel, currency, start, end],
  )
  for (const r of fdRows) {
    const p = byDate.get(manilaDateOf(new Date(r.ca)))
    if (p) p.firstDepUsers += 1
  }

  const points = [...byDate.values()]
  for (const p of points) p.arpu = p.firstDepUsers > 0 ? p.depositAmount / p.firstDepUsers : null
  return { channel, currency, points }
}

// ─────────────────────────────────────────────────────────────────────────
// 渠道下拉：配置过的短码 ∪ 归因表实际出现过的渠道
// ─────────────────────────────────────────────────────────────────────────
export async function listChannelCodes(env: Env): Promise<string[]> {
  const db = pool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT channel_code c FROM bg_capi_pixel_token WHERE channel_code IS NOT NULL
     UNION SELECT channel_code FROM bg_user_attribution WHERE channel_code IS NOT NULL`,
  )
  return rows.map((r) => String(r.c)).filter(Boolean).sort()
}

// ─────────────────────────────────────────────────────────────────────────
// 用户详情：单个用户的完整归因快照
// ─────────────────────────────────────────────────────────────────────────
export interface UserAttributionDetail {
  channelCode: string | null
  clickPlatform: string
  clickId: string | null
  utmSource: string | null
  utmCampaign: string | null
  landingHost: string | null
  landingPath: string | null
  referrer: string | null
  clientIp: string | null
  createdAt: string
}

export async function getUserAttributionDetail(env: Env, userId: string): Promise<UserAttributionDetail | null> {
  const db = pool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT channel_code, click_platform, click_id, utm_source, utm_campaign,
            landing_host, landing_path, referrer, client_ip, created_at
     FROM bg_user_attribution WHERE user_id = ? LIMIT 1`,
    [userId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    channelCode: r.channel_code ? String(r.channel_code) : null,
    clickPlatform: String(r.click_platform ?? 'other'),
    clickId: r.click_id ? String(r.click_id) : null,
    utmSource: r.utm_source ? String(r.utm_source) : null,
    utmCampaign: r.utm_campaign ? String(r.utm_campaign) : null,
    landingHost: r.landing_host ? String(r.landing_host) : null,
    landingPath: r.landing_path ? String(r.landing_path) : null,
    referrer: r.referrer ? String(r.referrer) : null,
    clientIp: r.client_ip ? String(r.client_ip) : null,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 渠道 CPA 单价配置
// ─────────────────────────────────────────────────────────────────────────
export interface ChannelPrice { channelCode: string; cpaUsd: number; remark: string | null; updatedAt: string }

export async function listChannelPrices(env: Env): Promise<ChannelPrice[]> {
  const db = pool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT channel_code, cpa_usd, remark, updated_at FROM bg_ad_channel_price ORDER BY channel_code`,
  )
  return rows.map((r) => ({
    channelCode: String(r.channel_code),
    cpaUsd: Number(r.cpa_usd),
    remark: r.remark ? String(r.remark) : null,
    updatedAt: new Date(r.updated_at as Date).toISOString(),
  }))
}

export async function upsertChannelPrice(env: Env, channelCode: string, cpaUsd: number, remark: string | null): Promise<void> {
  const db = pool(env)
  await db.execute(
    `INSERT INTO bg_ad_channel_price (channel_code, cpa_usd, remark) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE cpa_usd = VALUES(cpa_usd), remark = VALUES(remark)`,
    [channelCode, cpaUsd, remark],
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 渠道质量对比：以「注册同期群」为口径，衡量买来的量值不值 CPA
//   留存/复充/人均累计充值(LTV雏形)/刷量预警；回本倍数由前端用 cpaUsd×usdToPhp 算
// ─────────────────────────────────────────────────────────────────────────
export interface ChannelQualityRow {
  channelCode: string
  regUsers: number
  firstDepUsers: number
  depositAmount: number
  arpu: number | null
  reDepUsers: number
  reDepRate: number | null
  d1Retained: number
  d7Retained: number
  avgLtvPhp: number | null
  cpaUsd: number
  suspiciousUsers: number
}

export async function getChannelQuality(
  env: Env,
  opts: { from: string; to: string; currency: string },
): Promise<{ rows: ChannelQualityRow[]; usdToPhp: number }> {
  const db = pool(env)
  const { currency } = opts
  const startMs = Date.parse(`${opts.from}T00:00:00+08:00`)
  const endMs = Date.parse(`${opts.to}T00:00:00+08:00`) + DAY_MS
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)

  // 1. 注册同期群
  const [users] = await db.query<RowDataPacket[]>(
    `SELECT user_id, channel_code, created_at, client_ip FROM bg_user_attribution
     WHERE channel_code IS NOT NULL AND created_at>=? AND created_at<?`,
    [start, end],
  )
  if (!users.length) return { rows: [], usdToPhp: env.USDT_TO_PHP_RATE }
  const uid = users.map((u) => String(u.user_id))
  const ph = uid.map(() => '?').join(',')
  const regDay = new Map<string, string>()
  for (const u of users) regDay.set(String(u.user_id), manilaDateOf(new Date(u.created_at as Date)))

  // 2. 充值：paid 订单数 + 累计充值额(指定币种)
  const [deps] = await db.query<RowDataPacket[]>(
    `SELECT user_id, COUNT(*) cnt, COALESCE(SUM(amount),0) amt FROM bg_deposit_order
     WHERE status='paid' AND currency=? AND user_id IN (${ph}) GROUP BY user_id`,
    [currency, ...uid],
  )
  const depByUser = new Map<string, { cnt: number; amt: number }>()
  for (const d of deps) depByUser.set(String(d.user_id), { cnt: Number(d.cnt), amt: Number(d.amt) })

  // 3. 留存：活跃日集合
  const [acts] = await db.query<RowDataPacket[]>(
    `SELECT user_id, stat_date FROM bi_user_active_day WHERE user_id IN (${ph})`, uid,
  )
  const activeDays = new Map<string, Set<string>>()
  for (const a of acts) {
    const k = String(a.user_id)
    if (!activeDays.has(k)) activeDays.set(k, new Set())
    activeDays.get(k)!.add(dateKey(a.stat_date))
  }
  const dayShift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00+08:00`) + n * DAY_MS + 8 * 3600 * 1000).toISOString().slice(0, 10)

  // 4. 刷量：渠道内同注册IP≥2账号
  const ipCount = new Map<string, Map<string, number>>()
  for (const u of users) {
    const ch = String(u.channel_code)
    const ip = u.client_ip ? String(u.client_ip) : ''
    if (!ip) continue
    if (!ipCount.has(ch)) ipCount.set(ch, new Map())
    const m = ipCount.get(ch)!
    m.set(ip, (m.get(ip) ?? 0) + 1)
  }

  const agg = new Map<string, ChannelQualityRow>()
  const rowOf = (ch: string): ChannelQualityRow => {
    let r = agg.get(ch)
    if (!r) {
      r = { channelCode: ch, regUsers: 0, firstDepUsers: 0, depositAmount: 0, arpu: null, reDepUsers: 0, reDepRate: null, d1Retained: 0, d7Retained: 0, avgLtvPhp: null, cpaUsd: 0, suspiciousUsers: 0 }
      agg.set(ch, r)
    }
    return r
  }
  for (const u of users) {
    const id = String(u.user_id)
    const row = rowOf(String(u.channel_code))
    row.regUsers += 1
    const dep = depByUser.get(id)
    if (dep && dep.amt > 0) {
      row.firstDepUsers += 1
      row.depositAmount += dep.amt
      if (dep.cnt >= 2) row.reDepUsers += 1
    }
    const days = activeDays.get(id)
    const rd = regDay.get(id)!
    if (days?.has(dayShift(rd, 1))) row.d1Retained += 1
    if (days?.has(dayShift(rd, 7))) row.d7Retained += 1
  }
  for (const [ch, ips] of ipCount) {
    let sus = 0
    for (const c of ips.values()) if (c >= 2) sus += c
    rowOf(ch).suspiciousUsers = sus
  }

  const prices = await listChannelPrices(env)
  const priceMap = new Map(prices.map((p) => [p.channelCode, p.cpaUsd]))
  const rows = [...agg.values()]
  for (const r of rows) {
    r.arpu = r.firstDepUsers > 0 ? r.depositAmount / r.firstDepUsers : null
    r.avgLtvPhp = r.arpu
    r.reDepRate = r.firstDepUsers > 0 ? r.reDepUsers / r.firstDepUsers : null
    r.cpaUsd = priceMap.get(r.channelCode) ?? 0
  }
  rows.sort((a, b) => b.firstDepUsers - a.firstDepUsers || b.regUsers - a.regUsers)
  return { rows, usdToPhp: env.USDT_TO_PHP_RATE }
}

export { isValidChannel }
