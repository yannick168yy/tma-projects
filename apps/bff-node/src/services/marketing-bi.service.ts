// 买量渠道 BI：按 channel_code（投手渠道）× 马尼拉日实时统计投放核心指标。
// 与 bi_daily_* 聚合表不同，这里直接查业务表——投放要看当天实时消耗，10 分钟延迟的
// 预聚合不够用；且单渠道数据量小，走 bg_user_attribution.idx_channel_created 索引足够快。
//
// 指标口径对齐投放合作条款：
//   注册数     = 当日归因到该渠道的新注册（attribution.created_at 即注册时刻，仅 isNewUser 写入）
//   首存人数   = 平台历史首笔成功充值发生在当日、且归因到该渠道的人
//   客均       = 当日该渠道所有用户的充值总额 ÷ 首存人数
//   首存成本   = 广告花费在投手侧，我方只给首存数；成本由投手用「花费 ÷ 首存数」自算
//   后台金额口径 = 全币种折 USDT 合并；CAPI 上报仍保留原有 PHP 口径。
//               买量用户首笔充 USDT/USDC 也必须计入首存，单币种过滤会漏
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getRate } from './exchange-rate.service.js'
import { childLogger } from '../lib/logger.js'
import type { Env } from '../config/env.js'
import type { BiMarket } from './bi.service.js'
import { getSiteDomainMappings } from './site-domain.service.js'

const log = childLogger('marketing-bi')
const DAY_MS = 24 * 60 * 60 * 1000

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/** 马尼拉某天 0 点的 UTC 毫秒（offsetDays 相对今天） */
function marketOffset(market: BiMarket): number {
  return market === 'ID' ? 7 : 8
}

function marketDateOf(d: Date, market: BiMarket): string {
  return new Date(d.getTime() + marketOffset(market) * 3600 * 1000).toISOString().slice(0, 10)
}

function marketCurrency(market: BiMarket): string {
  return market === 'PH' ? 'PHP' : market === 'ID' ? 'IDR' : 'USDT'
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

/** 测试链币种归一化到主网符号取汇率（TRX_TESTNET→TRX），测试环境的测试币充值照常折算入账 */
function rateSymbol(currency: string): string {
  const c = currency.toUpperCase().replace(/_TESTNET$/, '')
  return c === 'USD' ? 'USDT' : c
}

/** 1 单位原币种折算为 USDT；复用汇率管理中的「原币→PHP」快照，不产生额外 API 请求。 */
export async function usdtRateMap(redis: Redis, env: Env, currencies: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (const currency of currencies) {
    const symbol = rateSymbol(currency)
    if (symbol === 'USDT' || symbol === 'USDC') { map.set(currency, 1); continue }
    try {
      map.set(currency, (await getRate(redis, symbol, 'USDT', env)).rate)
    } catch {
      map.set(currency, 0)
    }
  }
  return map
}

async function scopedRateMap(redis: Redis, env: Env, currencies: string[], market: BiMarket): Promise<Map<string, number>> {
  if (market === 'ALL') return usdtRateMap(redis, env, currencies)
  const target = marketCurrency(market)
  const map = new Map<string, number>()
  for (const currency of [...new Set(currencies)]) {
    const symbol = rateSymbol(currency)
    if (symbol === target) { map.set(currency, 1); continue }
    try {
      map.set(currency, (await getRate(redis, symbol, target, env)).rate)
    } catch {
      map.set(currency, 0)
    }
  }
  return map
}

/**
 * 渠道汇总报表：给定马尼拉日范围 [from, to]（含端点），按 channel_code 聚合。
 * 金额全币种折 USDT 合并；channel 省略则返回全部渠道。
 */
export async function getAdSourceReport(
  env: Env,
  redis: Redis,
  opts: { from: string; to: string; channel?: string; market?: BiMarket },
): Promise<AdSourceReport> {
  const db = pool(env)
  const market = opts.market ?? 'ALL'
  const offset = marketOffset(market)
  const startMs = Date.parse(`${opts.from}T00:00:00+${String(offset).padStart(2, '0')}:00`)
  const endMs = Date.parse(`${opts.to}T00:00:00+${String(offset).padStart(2, '0')}:00`) + DAY_MS
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)
  const chanFilter = opts.channel ? ' AND a.channel_code=?' : ''
  const chanArg = opts.channel ? [opts.channel] : []
  const marketFilter = market === 'ALL' ? '' : ' AND u.market=?'
  const marketArg = market === 'ALL' ? [] : [market]

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
  const marketDomains = market === 'ALL'
    ? []
    : (await getSiteDomainMappings(redis, env)).filter((item) => item.enabled && item.market === market).map((item) => item.domain)
  const pMarketFilter = market === 'ALL' ? '' : marketDomains.length > 0
    ? " AND REPLACE(JSON_UNQUOTE(JSON_EXTRACT(p.attr_json,'$.lh')),'www.','') IN (?)"
    : ' AND 1=0'
  const [dlRows] = await db.query<RowDataPacket[]>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(p.attr_json,'$.c')) code,
            COUNT(*) dl, COUNT(p.matched_at) inst
     FROM bg_pending_install p
     WHERE p.created_at>=? AND p.created_at<?
       AND JSON_UNQUOTE(JSON_EXTRACT(p.attr_json,'$.c')) IS NOT NULL${pChanFilter}${pMarketFilter}
     GROUP BY code`,
    [start, end, ...chanArg, ...(market === 'ALL' || marketDomains.length === 0 ? [] : [marketDomains])],
  )
  for (const r of dlRows) {
    const row = rowOf(String(r.code))
    row.downloads = Number(r.dl)
    row.installs = Number(r.inst)
  }

  // 注册数：attribution.created_at 即注册时刻
  const [regRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, COUNT(*) cnt
     FROM bg_user_attribution a JOIN bg_user u ON u.id=a.user_id
     WHERE a.channel_code IS NOT NULL AND a.created_at>=? AND a.created_at<?${chanFilter}${marketFilter}
     GROUP BY a.channel_code`,
    [start, end, ...chanArg, ...marketArg],
  )
  for (const r of regRows) rowOf(String(r.code)).regUsers = Number(r.cnt)

  // 当日充值（全币种）：按 渠道×币种 聚合后折 USDT 相加；充值人数单独按渠道去重（跨币种不重计）
  const [depRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, d.currency cur, COALESCE(SUM(d.amount),0) amt
     FROM bg_deposit_order d
     JOIN bg_user_attribution a ON a.user_id=d.user_id
     JOIN bg_user u ON u.id=d.user_id
     WHERE d.status='paid' AND d.created_at>=? AND d.created_at<?
       AND a.channel_code IS NOT NULL${chanFilter}${marketFilter}
     GROUP BY a.channel_code, d.currency`,
    [start, end, ...chanArg, ...marketArg],
  )
  const rates = await scopedRateMap(redis, env, depRows.map((r) => String(r.cur)), market)
  for (const r of depRows) {
    rowOf(String(r.code)).depositAmount += Number(r.amt) * (rates.get(String(r.cur)) ?? 0)
  }
  const [depUserRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, COUNT(DISTINCT d.user_id) users
     FROM bg_deposit_order d
     JOIN bg_user_attribution a ON a.user_id=d.user_id
     JOIN bg_user u ON u.id=d.user_id
     WHERE d.status='paid' AND d.created_at>=? AND d.created_at<?
       AND a.channel_code IS NOT NULL${chanFilter}${marketFilter}
     GROUP BY a.channel_code`,
    [start, end, ...chanArg, ...marketArg],
  )
  for (const r of depUserRows) rowOf(String(r.code)).depositUsers = Number(r.users)

  // 首存：平台历史首笔成功充值在当日窗口内（NOT EXISTS 更早的 paid 单，任意币种）。
  // 每个用户只会落在其首单币种的分组里，跨币种分组累加人数不会重计
  const [fdRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, d.currency cur, COUNT(DISTINCT d.user_id) users, COALESCE(SUM(d.amount),0) amt
     FROM bg_deposit_order d
     JOIN bg_user_attribution a ON a.user_id=d.user_id
     JOIN bg_user u ON u.id=d.user_id
     WHERE d.status='paid' AND d.created_at>=? AND d.created_at<?
       AND a.channel_code IS NOT NULL${chanFilter}${marketFilter}
       AND NOT EXISTS (
         SELECT 1 FROM bg_deposit_order d2
         WHERE d2.user_id=d.user_id AND d2.status='paid' AND d2.created_at<d.created_at
       )
     GROUP BY a.channel_code, d.currency`,
    [start, end, ...chanArg, ...marketArg],
  )
  const fdRates = await scopedRateMap(redis, env, fdRows.map((r) => String(r.cur)), market)
  for (const r of fdRows) {
    const row = rowOf(String(r.code))
    row.firstDepUsers += Number(r.users)
    row.firstDepAmount += Number(r.amt) * (fdRates.get(String(r.cur)) ?? 0)
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

  return { from: opts.from, to: opts.to, currency: marketCurrency(market), rows, totals }
}

export interface AdSourceTrendPoint {
  date: string
  regUsers: number
  firstDepUsers: number
  depositAmount: number
  arpu: number | null
}

/**
 * 单渠道逐日趋势，用于投手面板画曲线。channel 必填。金额全币种折 USDT。
 */
export async function getAdSourceTrend(
  env: Env,
  redis: Redis,
  opts: { channel: string; from: string; to: string; market?: BiMarket },
): Promise<{ channel: string; currency: string; points: AdSourceTrendPoint[] }> {
  const db = pool(env)
  const { channel } = opts
  const market = opts.market ?? 'ALL'
  const offset = marketOffset(market)
  const startMs = Date.parse(`${opts.from}T00:00:00+${String(offset).padStart(2, '0')}:00`)
  const endMs = Date.parse(`${opts.to}T00:00:00+${String(offset).padStart(2, '0')}:00`) + DAY_MS
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)

  // 预建全部日期槽，无数据的日子补 0，曲线不断点
  const byDate = new Map<string, AdSourceTrendPoint>()
  for (let ms = startMs; ms < endMs; ms += DAY_MS) {
    const d = new Date(ms + offset * 3600 * 1000).toISOString().slice(0, 10)
    byDate.set(d, { date: d, regUsers: 0, firstDepUsers: 0, depositAmount: 0, arpu: null })
  }

  const [regRows] = await db.query<RowDataPacket[]>(
    `SELECT a.created_at ca FROM bg_user_attribution a JOIN bg_user u ON u.id=a.user_id
     WHERE a.channel_code=? AND a.created_at>=? AND a.created_at<?${market === 'ALL' ? '' : ' AND u.market=?'}`,
    market === 'ALL' ? [channel, start, end] : [channel, start, end, market],
  )
  for (const r of regRows) {
    const p = byDate.get(marketDateOf(new Date(r.ca), market))
    if (p) p.regUsers += 1
  }

  const [depRows] = await db.query<RowDataPacket[]>(
    `SELECT d.created_at ca, d.amount amt, d.currency cur
     FROM bg_deposit_order d JOIN bg_user_attribution a ON a.user_id=d.user_id JOIN bg_user u ON u.id=d.user_id
     WHERE a.channel_code=? AND d.status='paid' AND d.created_at>=? AND d.created_at<?${market === 'ALL' ? '' : ' AND u.market=?'}`,
    market === 'ALL' ? [channel, start, end] : [channel, start, end, market],
  )
  const rates = await scopedRateMap(redis, env, depRows.map((r) => String(r.cur)), market)
  for (const r of depRows) {
    const p = byDate.get(marketDateOf(new Date(r.ca), market))
    if (p) p.depositAmount += Number(r.amt) * (rates.get(String(r.cur)) ?? 0)
  }

  const [fdRows] = await db.query<RowDataPacket[]>(
    `SELECT d.created_at ca
     FROM bg_deposit_order d JOIN bg_user_attribution a ON a.user_id=d.user_id JOIN bg_user u ON u.id=d.user_id
     WHERE a.channel_code=? AND d.status='paid' AND d.created_at>=? AND d.created_at<?
       ${market === 'ALL' ? '' : 'AND u.market=?'}
       AND NOT EXISTS (
         SELECT 1 FROM bg_deposit_order d2
         WHERE d2.user_id=d.user_id AND d2.status='paid' AND d2.created_at<d.created_at
       )`,
    market === 'ALL' ? [channel, start, end] : [channel, start, end, market],
  )
  for (const r of fdRows) {
    const p = byDate.get(marketDateOf(new Date(r.ca), market))
    if (p) p.firstDepUsers += 1
  }

  const points = [...byDate.values()]
  for (const p of points) p.arpu = p.firstDepUsers > 0 ? p.depositAmount / p.firstDepUsers : null
  return { channel, currency: marketCurrency(market), points }
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
  // 利润侧（全币种折 USDT）：让页面能回答"这个渠道到底赚没赚"，不只看流水
  withdrawAmount: number      // 已完成提现额（completed）
  walletBalance: number       // 当前场内余额（bg_wallet.available，玩家还能提走的钱=负债）
  rejectedWithdraw: number    // 被风控拦下的提现额（admin_rejected/rejected），薅羊毛强信号
  netCashPhp: number          // 净现金 = 充值 − 完成提现（平台现在手里的现金）
  ngrPhp: number              // 真毛利雏形 = 充值 − 完成提现 − 场内余额（扣掉未兑付负债）
}

export async function getChannelQuality(
  env: Env,
  redis: Redis,
  opts: { from: string; to: string; market?: BiMarket },
): Promise<{ rows: ChannelQualityRow[]; usdToPhp: number }> {
  const db = pool(env)
  const market = opts.market ?? 'ALL'
  const offset = marketOffset(market)
  const startMs = Date.parse(`${opts.from}T00:00:00+${String(offset).padStart(2, '0')}:00`)
  const endMs = Date.parse(`${opts.to}T00:00:00+${String(offset).padStart(2, '0')}:00`) + DAY_MS
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)

  // 1. 注册同期群
  const [users] = await db.query<RowDataPacket[]>(
    `SELECT a.user_id, a.channel_code, a.created_at, a.client_ip
     FROM bg_user_attribution a JOIN bg_user u ON u.id=a.user_id
     WHERE a.channel_code IS NOT NULL AND a.created_at>=? AND a.created_at<?${market === 'ALL' ? '' : ' AND u.market=?'}`,
    market === 'ALL' ? [start, end] : [start, end, market],
  )
  if (!users.length) return { rows: [], usdToPhp: 1 }
  const uid = users.map((u) => String(u.user_id))
  const ph = uid.map(() => '?').join(',')
  const regDay = new Map<string, string>()
  for (const u of users) regDay.set(String(u.user_id), marketDateOf(new Date(u.created_at as Date), market))

  // 2. 充值：paid 订单数 + 累计充值额（全币种折 USDT）
  const [deps] = await db.query<RowDataPacket[]>(
    `SELECT user_id, currency cur, COUNT(*) cnt, COALESCE(SUM(amount),0) amt FROM bg_deposit_order
     WHERE status='paid' AND user_id IN (${ph}) GROUP BY user_id, currency`,
    uid,
  )
  const depRates = await scopedRateMap(redis, env, deps.map((d) => String(d.cur)), market)
  const depByUser = new Map<string, { cnt: number; amt: number }>()
  for (const d of deps) {
    const k = String(d.user_id)
    const prev = depByUser.get(k) ?? { cnt: 0, amt: 0 }
    prev.cnt += Number(d.cnt)
    prev.amt += Number(d.amt) * (depRates.get(String(d.cur)) ?? 0)
    depByUser.set(k, prev)
  }

  // 2b. 利润侧：完成提现 / 场内余额 / 被拦提现，均按 user×币种取回后折 USDT 归并到人
  const [wds] = await db.query<RowDataPacket[]>(
    `SELECT user_id, currency cur, COALESCE(SUM(amount),0) amt FROM bg_withdraw_order
     WHERE status='completed' AND user_id IN (${ph}) GROUP BY user_id, currency`,
    uid,
  )
  const [bals] = await db.query<RowDataPacket[]>(
    `SELECT user_id, currency cur, COALESCE(SUM(available),0) amt FROM bg_wallet
     WHERE user_id IN (${ph}) GROUP BY user_id, currency`,
    uid,
  )
  const [rjs] = await db.query<RowDataPacket[]>(
    `SELECT user_id, currency cur, COALESCE(SUM(amount),0) amt FROM bg_withdraw_order
     WHERE status IN ('admin_rejected','rejected') AND user_id IN (${ph}) GROUP BY user_id, currency`,
    uid,
  )
  const profitRates = await scopedRateMap(redis, env, [...wds, ...bals, ...rjs].map((r) => String(r.cur)), market)
  const sumUsdtByUser = (rows: RowDataPacket[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const k = String(r.user_id)
      m.set(k, (m.get(k) ?? 0) + Number(r.amt) * (profitRates.get(String(r.cur)) ?? 0))
    }
    return m
  }
  const wdByUser = sumUsdtByUser(wds)
  const balByUser = sumUsdtByUser(bals)
  const rjByUser = sumUsdtByUser(rjs)

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
  const dayShift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00+${String(offset).padStart(2, '0')}:00`) + n * DAY_MS + offset * 3600 * 1000).toISOString().slice(0, 10)

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
      r = { channelCode: ch, regUsers: 0, firstDepUsers: 0, depositAmount: 0, arpu: null, reDepUsers: 0, reDepRate: null, d1Retained: 0, d7Retained: 0, avgLtvPhp: null, cpaUsd: 0, suspiciousUsers: 0, withdrawAmount: 0, walletBalance: 0, rejectedWithdraw: 0, netCashPhp: 0, ngrPhp: 0 }
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
    row.withdrawAmount += wdByUser.get(id) ?? 0
    row.walletBalance += balByUser.get(id) ?? 0
    row.rejectedWithdraw += rjByUser.get(id) ?? 0
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
    r.netCashPhp = r.depositAmount - r.withdrawAmount
    r.ngrPhp = r.depositAmount - r.withdrawAmount - r.walletBalance
  }
  rows.sort((a, b) => b.firstDepUsers - a.firstDepUsers || b.regUsers - a.regUsers)
  let usdToPhp = 1
  if (market !== 'ALL') {
    try { usdToPhp = (await getRate(redis, 'USDT', marketCurrency(market), env)).rate } catch { usdToPhp = 1 }
  }
  return { rows, usdToPhp }
}

// ─────────────────────────────────────────────────────────────────────────
// 渠道对比点评：把选中渠道的数字拼成可读文本（既是无 key 时的兜底，也是喂 Gemini 的原料），
// 有 GEMINI_API_KEY 时润色成自然语言点评。操作人在页面主动点「生成AI点评」才调用。
// ─────────────────────────────────────────────────────────────────────────
export interface ChannelVerdict { text: string; ai: boolean }

const vMoney = (v: number): string => Math.round(v).toLocaleString('en-US')
const vPct = (v: number | null): string => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

function buildVerdictText(
  rows: ChannelQualityRow[],
  spends: Record<string, number>,
  usdToPhp: number,
  from: string,
  to: string,
  currency: string,
): string {
  if (!rows.length) return '未选择任何渠道，或所选渠道在该区间无数据。'
  const lines = [`投放渠道对比（${from} ~ ${to}，金额单位 ${currency}）：`]
  for (const r of rows) {
    const conv = r.regUsers > 0 ? `${((r.firstDepUsers / r.regUsers) * 100).toFixed(1)}%` : '—'
    const susPct = r.regUsers > 0 ? `${((r.suspiciousUsers / r.regUsers) * 100).toFixed(0)}%` : '0%'
    const d1 = r.regUsers > 0 ? `${((r.d1Retained / r.regUsers) * 100).toFixed(0)}%` : '0%'
    const parts = [
      `【${r.channelCode}】注册${r.regUsers}、首存${r.firstDepUsers}（转化${conv}）`,
      `充值${vMoney(r.depositAmount)} ${currency}、完成提现${vMoney(r.withdrawAmount)} ${currency}、场内余额${vMoney(r.walletBalance)} ${currency}`,
      `净现金${vMoney(r.netCashPhp)} ${currency}、真毛利NGR${vMoney(r.ngrPhp)} ${currency}`,
      `复充率${vPct(r.reDepRate)}、D1留存${d1}、同IP多账号${r.suspiciousUsers}(${susPct})`,
    ]
    if (r.rejectedWithdraw > 0) parts.push(`异常提现被拦${vMoney(r.rejectedWithdraw)} ${currency}`)
    const spend = spends[r.channelCode]
    if (typeof spend === 'number' && spend > 0) {
      const cpa = (spend / Math.max(r.regUsers, 1)).toFixed(2)
      const cpd = r.firstDepUsers > 0 ? `$${(spend / r.firstDepUsers).toFixed(2)}` : '—'
      const roas = (r.depositAmount / usdToPhp / spend).toFixed(2)
      const netRoi = (r.netCashPhp / usdToPhp / spend).toFixed(2)
      parts.push(`花费$${spend}、CPA$${cpa}/注册、CPD${cpd}/首存、毛ROAS${roas}×、净现金ROI${netRoi}×`)
    }
    lines.push(parts.join('；'))
  }
  return lines.join('\n')
}

export async function generateChannelVerdict(
  env: Env,
  redis: Redis,
  opts: { from: string; to: string; channels: string[]; spends?: Record<string, number>; market?: BiMarket },
): Promise<ChannelVerdict> {
  const market = opts.market ?? 'ALL'
  const { rows, usdToPhp } = await getChannelQuality(env, redis, { from: opts.from, to: opts.to, market })
  const sel = rows.filter((r) => opts.channels.includes(r.channelCode))
  const raw = buildVerdictText(sel, opts.spends ?? {}, usdToPhp, opts.from, opts.to, marketCurrency(market))
  if (!env.GEMINI_API_KEY || sel.length === 0) return { text: raw, ai: false }
  try {
    const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY)
    const model = ai.getGenerativeModel(
      {
        model: 'gemini-2.5-flash',
        systemInstruction: [
          '你是菲律宾在线游戏平台 BetoGo 的买量数据分析师，给老板写投放渠道对比点评。',
          '硬性规则：所有数字、百分比、渠道名必须与原文完全一致，不得编造或推算原文没有的新数字；',
          '重点判断：每个渠道值不值买量成本（看 CPA/ROAS/净现金ROI）、净现金是否为正、是否有薅羊毛信号（同IP多账号占比高、异常提现被拦）、留存与复充；',
          '结构：一句话总体结论 → 逐个渠道点评优劣 → 风险提示 → 一条可执行建议；全文不超过 300 字；',
          '直接从正文开始输出，不要标题、不要 Markdown 加粗、不要任何前言。',
        ].join('\n'),
      },
      { timeout: 20_000 },
    )
    const res = await model.generateContent(`根据以下渠道数据写对比点评：\n\n${raw}`)
    const text = res.response.text().trim()
    return text ? { text, ai: true } : { text: raw, ai: false }
  } catch (err) {
    log.warn({ err }, 'gemini channel verdict error, fallback to raw')
    return { text: raw, ai: false }
  }
}

export { isValidChannel }
